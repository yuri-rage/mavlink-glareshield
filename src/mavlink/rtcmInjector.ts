import { mavlinkConnection } from './connection';
import { useTelemetryStore } from '../store/telemetryStore';

export interface NtripConfig {
  host: string;
  port: number;
  mountpoint: string;
  username?: string;
  password?: string;
  protocol?: 'websocket' | 'http';
  sendGga?: boolean;
}

export interface RtcmMessageTypeInfo {
  type: number;
  name: string;
  count: number;
  lastSeen: number;
}

export interface RtcmInjectorState {
  status: 'disconnected' | 'connecting' | 'connected' | 'streaming' | 'error';
  source: 'none' | 'serial' | 'ntrip';
  bytesReceived: number;
  bytesInjected: number;
  packetsSent: number;
  messagesInjected: number;
  dataRateBps: number;
  packetRateHz: number;
  detectedTypes: Record<number, RtcmMessageTypeInfo>;
  error: string | null;
}

// RTCM 3.x message name descriptions
export const RTCM_TYPE_NAMES: Record<number, string> = {
  1001: 'GPS L1 Only',
  1002: 'GPS L1 Ext',
  1003: 'GPS L1/L2',
  1004: 'GPS L1/L2 Ext',
  1005: 'Station ARP (Base Pos)',
  1006: 'Station ARP with Height',
  1007: 'Antenna Descriptor',
  1008: 'Antenna Serial Number',
  1019: 'GPS Ephemeris',
  1020: 'GLONASS Ephemeris',
  1074: 'GPS MSM4',
  1075: 'GPS MSM5',
  1077: 'GPS MSM7 (Full)',
  1084: 'GLO MSM4',
  1085: 'GLO MSM5',
  1087: 'GLO MSM7 (Full)',
  1094: 'GAL MSM4',
  1095: 'GAL MSM5',
  1097: 'GAL MSM7 (Full)',
  1124: 'BDS MSM4',
  1125: 'BDS MSM5',
  1127: 'BDS MSM7 (Full)',
  1230: 'GLONASS Code-Phase Biases',
};

/**
 * Calculates 24-bit QualComm CRC24Q checksum used in RTCM 3.x.
 * Polynomial: 0x1864cfb
 */
export function calculateCrc24q(data: Uint8Array, length: number): number {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    crc ^= data[i] << 16;
    for (let j = 0; j < 8; j++) {
      crc <<= 1;
      if (crc & 0x1000000) {
        crc ^= 0x1864cfb;
      }
    }
  }
  return crc & 0xffffff;
}

/**
 * Formats standard NMEA GGA position sentence for NTRIP VRS caster feedback.
 */
export function generateNmeaGga(lat: number, lon: number, alt = 0): string {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  const timeStr = `${hh}${mm}${ss}.00`;

  const latAbs = Math.abs(lat);
  const latDeg = Math.floor(latAbs);
  const latMin = ((latAbs - latDeg) * 60).toFixed(4).padStart(7, '0');
  const latStr = `${String(latDeg).padStart(2, '0')}${latMin}`;
  const latHemi = lat >= 0 ? 'N' : 'S';

  const lonAbs = Math.abs(lon);
  const lonDeg = Math.floor(lonAbs);
  const lonMin = ((lonAbs - lonDeg) * 60).toFixed(4).padStart(7, '0');
  const lonStr = `${String(lonDeg).padStart(3, '0')}${lonMin}`;
  const lonHemi = lon >= 0 ? 'E' : 'W';

  const altStr = alt.toFixed(1);
  const sentenceBody = `GPGGA,${timeStr},${latStr},${latHemi},${lonStr},${lonHemi},1,12,1.0,${altStr},M,0.0,M,,`;

  let checksum = 0;
  for (let i = 0; i < sentenceBody.length; i++) {
    checksum ^= sentenceBody.charCodeAt(i);
  }
  const checksumHex = checksum.toString(16).toUpperCase().padStart(2, '0');

  return `$${sentenceBody}*${checksumHex}\r\n`;
}

/**
 * RTCM 3.x Streaming Frame Parser
 */
export class RtcmFrameParser {
  private buffer: Uint8Array = new Uint8Array(0);

  public append(chunk: Uint8Array): { frames: Uint8Array[]; msgTypes: number[] } {
    if (chunk.length === 0) return { frames: [], msgTypes: [] };

    // Concatenate chunk to internal buffer
    const newBuf = new Uint8Array(this.buffer.length + chunk.length);
    newBuf.set(this.buffer, 0);
    newBuf.set(chunk, this.buffer.length);
    this.buffer = newBuf;

    const frames: Uint8Array[] = [];
    const msgTypes: number[] = [];

    while (this.buffer.length >= 6) {
      // Find preamble 0xD3
      let startIdx = -1;
      for (let i = 0; i < this.buffer.length; i++) {
        if (this.buffer[i] === 0xd3) {
          startIdx = i;
          break;
        }
      }

      if (startIdx === -1) {
        this.buffer = new Uint8Array(0);
        break;
      }

      if (startIdx > 0) {
        this.buffer = this.buffer.subarray(startIdx);
      }

      if (this.buffer.length < 3) break;

      // Extract 10-bit payload length (bytes 1 & 2)
      const payloadLen = ((this.buffer[1] & 0x03) << 8) | this.buffer[2];
      const frameLen = 3 + payloadLen + 3; // 3 bytes header + payload + 3 bytes CRC

      if (this.buffer.length < frameLen) {
        // Need more data
        break;
      }

      // Check CRC24Q
      const frame = this.buffer.subarray(0, frameLen);
      const computedCrc = calculateCrc24q(frame, frameLen - 3);
      const expectedCrc = (frame[frameLen - 3] << 16) | (frame[frameLen - 2] << 8) | frame[frameLen - 1];

      if (computedCrc === expectedCrc) {
        // Valid frame! Extract 12-bit message number (first 12 bits of payload at offset 3)
        const msgType = (frame[3] << 4) | (frame[4] >> 4);
        frames.push(frame);
        msgTypes.push(msgType);
        this.buffer = this.buffer.subarray(frameLen);
      } else {
        // CRC mismatch - discard first byte (0xD3) and rescan
        this.buffer = this.buffer.subarray(1);
      }
    }

    return { frames, msgTypes };
  }

  public reset() {
    this.buffer = new Uint8Array(0);
  }
}

export class RtcmInjector {
  private state: RtcmInjectorState = {
    status: 'disconnected',
    source: 'none',
    bytesReceived: 0,
    bytesInjected: 0,
    packetsSent: 0,
    messagesInjected: 0,
    dataRateBps: 0,
    packetRateHz: 0,
    detectedTypes: {},
    error: null,
  };

  private listeners: Set<(state: RtcmInjectorState) => void> = new Set();
  private parser = new RtcmFrameParser();
  private seq = 0;

  // Rate tracking
  private recentBytes = 0;
  private recentPackets = 0;
  private rateTimer: any = null;

  // Connections
  private serialPort: any = null;
  private serialReader: any = null;
  private isSerialReading = false;

  private ntripSocket: WebSocket | null = null;
  private ntripAbortController: AbortController | null = null;
  private ggaIntervalTimer: any = null;

  constructor() {
    this.startRateMeter();
  }

  private startRateMeter() {
    if (this.rateTimer) clearInterval(this.rateTimer);
    this.rateTimer = setInterval(() => {
      this.state.dataRateBps = this.recentBytes;
      this.state.packetRateHz = this.recentPackets;
      this.recentBytes = 0;
      this.recentPackets = 0;
      this.notify();
    }, 1000);
    if (typeof this.rateTimer === 'object' && this.rateTimer && typeof (this.rateTimer as any).unref === 'function') {
      (this.rateTimer as any).unref();
    }
  }

  public stopRateMeter() {
    if (this.rateTimer) {
      clearInterval(this.rateTimer);
      this.rateTimer = null;
    }
  }

  public onStateChange(listener: (state: RtcmInjectorState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach((l) => l(this.state));
  }

  private updateState(patch: Partial<RtcmInjectorState>) {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  /**
   * Dispatches an RTCM3 frame into MAVLink GPS_RTCM_DATA packets (Msg ID 233).
   * Chunks large frames (>180 bytes) with fragmentation flags.
   */
  public injectRtcmFrame(frame: Uint8Array, msgType: number) {
    const encoder = mavlinkConnection.getEncoder();
    const frameLen = frame.length;
    this.recentBytes += frameLen;
    this.state.bytesReceived += frameLen;
    this.state.bytesInjected += frameLen;
    this.state.messagesInjected++;

    // Track detected message type
    const now = Date.now();
    const existing = this.state.detectedTypes[msgType];
    const name = RTCM_TYPE_NAMES[msgType] || `RTCM ${msgType}`;
    this.state.detectedTypes[msgType] = {
      type: msgType,
      name,
      count: (existing?.count ?? 0) + 1,
      lastSeen: now,
    };

    if (frameLen <= 180) {
      // Unfragmented packet (bit 0 = 0)
      const flags = (this.seq & 0x1f) << 3;
      const packet = encoder.createGpsRtcmData(flags, frame);
      mavlinkConnection.send(packet);
      this.seq = (this.seq + 1) & 0x1f;
      this.state.packetsSent++;
      this.recentPackets++;
    } else {
      // Fragmented across multiple packets (max 4 fragments: 0..3)
      const maxFrags = 4;
      const fragSize = 180;
      const numFrags = Math.min(Math.ceil(frameLen / fragSize), maxFrags);

      for (let fragId = 0; fragId < numFrags; fragId++) {
        const offset = fragId * fragSize;
        const len = Math.min(fragSize, frameLen - offset);
        const chunk = frame.subarray(offset, offset + len);

        // flags: bit 0 = 1 (fragmented), bits 1..2 = fragId, bits 3..7 = sequence
        const flags = 1 | ((fragId & 0x03) << 1) | ((this.seq & 0x1f) << 3);
        const packet = encoder.createGpsRtcmData(flags, chunk);
        mavlinkConnection.send(packet);
        this.state.packetsSent++;
        this.recentPackets++;
      }
      this.seq = (this.seq + 1) & 0x1f;
    }

    if (this.state.status === 'connected') {
      this.updateState({ status: 'streaming' });
    }
  }

  /**
   * Processes raw binary data from serial or NTRIP stream, parses RTCM frames,
   * and injects them into vehicle MAVLink.
   */
  public processRawStream(chunk: Uint8Array) {
    const { frames, msgTypes } = this.parser.append(chunk);
    for (let i = 0; i < frames.length; i++) {
      this.injectRtcmFrame(frames[i], msgTypes[i]);
    }
  }

  /**
   * Connects to a USB RTK Base Station via the Web Serial API (navigator.serial).
   */
  public async connectSerial(baudRate = 115200) {
    if (typeof navigator === 'undefined' || !('serial' in navigator)) {
      throw new Error('Web Serial API is not supported in this browser. Please use Chrome, Edge, or connect via NTRIP Caster.');
    }

    await this.disconnect();
    this.updateState({ status: 'connecting', source: 'serial', error: null });

    try {
      const navSerial = (navigator as any).serial;
      const port = await navSerial.requestPort();
      await port.open({ baudRate });

      this.serialPort = port;
      this.isSerialReading = true;
      this.updateState({ status: 'connected', source: 'serial' });

      // Start reader loop
      (async () => {
        while (port.readable && this.isSerialReading) {
          try {
            const reader = port.readable.getReader();
            this.serialReader = reader;
            while (this.isSerialReading) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value && value.length > 0) {
                this.processRawStream(value);
              }
            }
            reader.releaseLock();
          } catch (err: any) {
            if (this.isSerialReading) {
              console.error('[RTCM] Web Serial read error:', err);
            }
            break;
          }
        }
      })();
    } catch (err: any) {
      this.updateState({
        status: 'error',
        error: err?.message || 'Failed to open serial device',
      });
      throw err;
    }
  }

  /**
   * Connects to an NTRIP Caster via WebSocket (or HTTP streaming fetch).
   */
  public async connectNtrip(config: NtripConfig) {
    await this.disconnect();
    this.updateState({ status: 'connecting', source: 'ntrip', error: null });

    const host = config.host.trim();
    const port = config.port || 2101;
    const mountpoint = config.mountpoint.trim().replace(/^\//, '');
    const protocol = config.protocol || 'websocket';

    try {
      if (protocol === 'websocket' || host.startsWith('ws://') || host.startsWith('wss://')) {
        let wsUrl: string;
        if (host.startsWith('ws://') || host.startsWith('wss://')) {
          wsUrl = host;
        } else {
          wsUrl = `ws://${host}:${port}/${mountpoint}`;
        }

        const socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';
        this.ntripSocket = socket;

        socket.onopen = () => {
          this.updateState({ status: 'connected', source: 'ntrip' });
          console.log(`[NTRIP] Connected to WebSocket caster at ${wsUrl}`);

          // Send NTRIP authorization headers if supported by WebSocket proxy
          if (config.username || config.password) {
            const auth = btoa(`${config.username || ''}:${config.password || ''}`);
            socket.send(`GET /${mountpoint} HTTP/1.0\r\nUser-Agent: NTRIP MavlinkGlareshield/1.0\r\nAuthorization: Basic ${auth}\r\n\r\n`);
          }

          // Start GGA feedback loop if enabled
          if (config.sendGga) {
            this.startGgaLoop((gga) => {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(gga);
              }
            });
          }
        };

        socket.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            this.processRawStream(new Uint8Array(event.data));
          } else if (typeof event.data === 'string') {
            // Check for ICY 200 OK or HTTP 200 OK
            if (event.data.includes('200 OK')) {
              this.updateState({ status: 'streaming' });
            }
          }
        };

        socket.onerror = (err) => {
          console.error('[NTRIP] WebSocket error:', err);
          this.updateState({ status: 'error', error: 'WebSocket connection failed' });
        };

        socket.onclose = () => {
          if (this.state.status === 'connected' || this.state.status === 'streaming') {
            this.updateState({ status: 'disconnected', source: 'none' });
          }
        };
      } else {
        // Direct HTTP / fetch streaming
        this.ntripAbortController = new AbortController();
        const headers: Record<string, string> = {
          'Ntrip-Version': 'Ntrip/2.0',
          'User-Agent': 'NTRIP MavlinkGlareshield/1.0',
        };
        if (config.username || config.password) {
          headers['Authorization'] = `Basic ${btoa(`${config.username || ''}:${config.password || ''}`)}`;
        }

        const url = `http://${host}:${port}/${mountpoint}`;
        const response = await fetch(url, {
          signal: this.ntripAbortController.signal,
          headers,
        });

        if (!response.ok && response.status !== 200) {
          throw new Error(`Caster returned HTTP ${response.status}: ${response.statusText}`);
        }

        this.updateState({ status: 'connected', source: 'ntrip' });
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Response body stream not available');

        // Start GGA feedback
        if (config.sendGga) {
          this.startGgaLoop(() => {
            // In HTTP streaming mode, GGA feedback is sent periodically via separate POST/request if supported
          });
        }

        (async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value && value.length > 0) {
                this.processRawStream(value);
              }
            }
          } catch (err: any) {
            if (err?.name !== 'AbortError') {
              console.error('[NTRIP] Fetch stream error:', err);
              this.updateState({ status: 'error', error: err?.message || 'Stream interrupted' });
            }
          }
        })();
      }
    } catch (err: any) {
      this.updateState({
        status: 'error',
        error: err?.message || 'NTRIP caster connection failed',
      });
      throw err;
    }
  }

  private startGgaLoop(sendFn: (ggaSentence: string) => void) {
    if (this.ggaIntervalTimer) clearInterval(this.ggaIntervalTimer);

    const sendGgaUpdate = () => {
      const pos = useTelemetryStore.getState().position;
      if (pos.lat !== 0 || pos.lon !== 0) {
        const gga = generateNmeaGga(pos.lat, pos.lon, pos.alt || pos.relativeAlt || 0);
        sendFn(gga);
      }
    };

    // Send initial GGA sentence
    sendGgaUpdate();
    // Repeat every 10 seconds (standard NTRIP VRS interval)
    this.ggaIntervalTimer = setInterval(sendGgaUpdate, 10000);
  }

  /**
   * Disconnects active serial or NTRIP stream.
   */
  public async disconnect() {
    if (this.ggaIntervalTimer) {
      clearInterval(this.ggaIntervalTimer);
      this.ggaIntervalTimer = null;
    }

    if (this.ntripSocket) {
      this.ntripSocket.close();
      this.ntripSocket = null;
    }

    if (this.ntripAbortController) {
      this.ntripAbortController.abort();
      this.ntripAbortController = null;
    }

    if (this.serialPort) {
      this.isSerialReading = false;
      try {
        if (this.serialReader) {
          await this.serialReader.cancel();
          this.serialReader = null;
        }
        await this.serialPort.close();
      } catch (err) {
        console.warn('[RTCM] Error closing serial port:', err);
      }
      this.serialPort = null;
    }

    this.parser.reset();
    this.updateState({
      status: 'disconnected',
      source: 'none',
      dataRateBps: 0,
      packetRateHz: 0,
      error: null,
    });
  }
}

export const rtcmInjector = new RtcmInjector();
