import { mavlinkConnection } from './connection';
import { useTelemetryStore } from '../store/telemetryStore';
import { useConnectionStore } from '../store/connectionStore';

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
  droppedOversizedFrames: number;
  droppedRateLimitedFrames: number;
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
 * Converts ECEF (Earth-Centered Earth-Fixed) X, Y, Z coordinates in meters to WGS-84
 * latitude, longitude (in degrees), and ellipsoidal height (in meters) via Bowring's method.
 */
export function ecefToWgs84(x: number, y: number, z: number): { lat: number; lon: number; alt: number } {
  const a = 6378137.0; // WGS-84 semi-major axis (meters)
  const f = 1.0 / 298.257223563;
  const b = a * (1.0 - f); // semi-minor axis
  const e2 = 2 * f - f * f; // first eccentricity squared
  const ep2 = (a * a - b * b) / (b * b); // second eccentricity squared

  const p = Math.hypot(x, y);
  if (p < 1e-6) {
    // Exactly or very near the geographic poles
    const lat = z >= 0 ? 90 : -90;
    const lon = 0;
    const alt = Math.abs(z) - b;
    return { lat, lon, alt };
  }

  const theta = Math.atan2(z * a, p * b);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);

  const lat = Math.atan2(
    z + ep2 * b * sinTheta * sinTheta * sinTheta,
    p - e2 * a * cosTheta * cosTheta * cosTheta
  );
  const lon = Math.atan2(y, x);

  const sinLat = Math.sin(lat);
  const N = a / Math.sqrt(1.0 - e2 * sinLat * sinLat);
  const alt = p / Math.cos(lat) - N;

  return {
    lat: (lat * 180) / Math.PI,
    lon: (lon * 180) / Math.PI,
    alt,
  };
}

/**
 * Reads an arbitrary signed bit-field from a byte buffer.
 */
export function getSignedBitsFromBuffer(data: Uint8Array, bitOffset: number, bitLength: number): bigint {
  let val = 0n;
  for (let i = 0; i < bitLength; i++) {
    const totalBit = bitOffset + i;
    const byteIdx = totalBit >> 3;
    if (byteIdx >= data.length) break;
    const bitInByte = 7 - (totalBit & 7);
    const bit = BigInt((data[byteIdx] >> bitInByte) & 1);
    val = (val << 1n) | bit;
  }
  const signBit = 1n << BigInt(bitLength - 1);
  if ((val & signBit) !== 0n) {
    val = val - (1n << BigInt(bitLength));
  }
  return val;
}

/**
 * Extracts Antenna Reference Point (ARP) base station coordinates from an RTCM 1005 or 1006 frame.
 * Returns WGS-84 coordinates { lat, lon, alt } or null if invalid or unparseable.
 */
export function extractRtcm1005Arp(frame: Uint8Array): { lat: number; lon: number; alt: number } | null {
  if (frame.length < 25) return null;
  if (frame[0] !== 0xd3) return null;

  const payloadLen = ((frame[1] & 0x03) << 8) | frame[2];
  if (payloadLen < 19 || frame.length < 3 + payloadLen + 3) return null;

  const payload = frame.subarray(3, 3 + payloadLen);
  const msgType = (payload[0] << 4) | (payload[1] >> 4);
  if (msgType !== 1005 && msgType !== 1006) return null;

  // DF025: ARP ECEF-X (int38, bits 34..71, scale 0.0001m)
  const xRaw = getSignedBitsFromBuffer(payload, 34, 38);
  // DF026: ARP ECEF-Y (int38, bits 74..111, scale 0.0001m)
  const yRaw = getSignedBitsFromBuffer(payload, 74, 38);
  // DF027: ARP ECEF-Z (int38, bits 114..151, scale 0.0001m)
  const zRaw = getSignedBitsFromBuffer(payload, 114, 38);

  if (xRaw === 0n && yRaw === 0n && zRaw === 0n) return null;

  const x = Number(xRaw) * 0.0001;
  const y = Number(yRaw) * 0.0001;
  const z = Number(zRaw) * 0.0001;

  const wgs = ecefToWgs84(x, y, z);
  if (isNaN(wgs.lat) || isNaN(wgs.lon) || Math.abs(wgs.lat) > 90 || Math.abs(wgs.lon) > 180) {
    return null;
  }
  return wgs;
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
    droppedOversizedFrames: 0,
    droppedRateLimitedFrames: 0,
    error: null,
  };

  private listeners: Set<(state: RtcmInjectorState) => void> = new Set();
  private parser = new RtcmFrameParser();
  private seq = 0;
  private msmLastSent: Record<number, number> = {};

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
  private unsubBridgeText: (() => void) | null = null;

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
    const frameLen = frame.length;

    // ArduPilot's rtcm_buffer holds at most 4 fragments of 180 bytes (720 bytes max).
    // Frames > 720 bytes overflow the buffer and cannot be reassembled; drop and count them.
    if (frameLen > 720) {
      this.state.droppedOversizedFrames++;
      this.notify();
      return;
    }

    // Limit RTCM injection rate based on link profile.
    // On low-bandwidth links (SiK radio 57.6k), multi-constellation MSM7 frames (1077, 1087, 1097, 1127)
    // starve MAVLink heartbeats and high-rate telemetry. Throttle MSM7 frames to 0.5 Hz per constellation.
    const bandwidthProfile = useConnectionStore.getState().bandwidthProfile;
    if (bandwidthProfile === 'low') {
      const isMsm7 = msgType === 1077 || msgType === 1087 || msgType === 1097 || msgType === 1127;
      if (isMsm7) {
        const now = Date.now();
        const lastSent = this.msmLastSent[msgType] || 0;
        if (now - lastSent < 2000) {
          this.state.droppedRateLimitedFrames++;
          this.notify();
          return;
        }
        this.msmLastSent[msgType] = now;
      }
    }

    const encoder = mavlinkConnection.getEncoder();
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

    // If base station ARP message (1005 or 1006), update store with base station coordinates
    if (msgType === 1005 || msgType === 1006) {
      const basePos = extractRtcm1005Arp(frame);
      if (basePos) {
        useTelemetryStore.getState().setBaseStationPosition(basePos);
      }
    }

    if (frameLen <= 180) {
      // Unfragmented packet (bit 0 = 0)
      const flags = (this.seq & 0x1f) << 3;
      const packet = encoder.createGpsRtcmData(flags, frame);
      mavlinkConnection.send(packet);
      this.seq = (this.seq + 1) & 0x1f;
      this.state.packetsSent++;
      this.recentPackets++;
    } else {
      // Fragmented across multiple packets
      const fragSize = 180;
      const numFrags = Math.ceil(frameLen / fragSize);

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

      // In ArduPilot's AP_GPS::handle_gps_rtcm_fragment, the reassembled buffer is delivered ONLY
      // when a fragment arrives with len < 180.
      // If frameLen is exactly 360 or 540 bytes, all chunks have len == 180, so ArduPilot never commits
      // the reassembly unless followed by a zero-length tail fragment (len == 0).
      if (frameLen === 360 || frameLen === 540) {
        const tailFragId = numFrags;
        const flags = 1 | ((tailFragId & 0x03) << 1) | ((this.seq & 0x1f) << 3);
        const tailPacket = encoder.createGpsRtcmData(flags, new Uint8Array(0));
        mavlinkConnection.send(tailPacket);
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
        // HTTP streaming mode:
        // Try local Vite dev server proxy endpoint first (/api/ntrip-stream),
        // which connects directly to the caster via raw TCP, strips ICY 200 OK headers, and streams without CORS issues.
        const proxyUrl = `/api/ntrip-stream?host=${encodeURIComponent(host)}&port=${port}&mountpoint=${encodeURIComponent(mountpoint)}` +
          (config.username ? `&username=${encodeURIComponent(config.username)}` : '') +
          (config.password ? `&password=${encodeURIComponent(config.password)}` : '');

        let response: Response | null = null;
        let usedProxy = false;

        try {
          this.ntripAbortController = new AbortController();
          response = await fetch(proxyUrl, {
            signal: this.ntripAbortController.signal,
          });
          if (response.ok) {
            usedProxy = true;
          }
        } catch {
          response = null;
        }

        // If local proxy endpoint is not available or returned non-ok (e.g. standalone production build):
        // Try via the companion bridge WebSocket connection if active
        if (!response || !response.ok) {
          if (mavlinkConnection.getStatus() === 'connected') {
            console.log('[NTRIP] Local Vite proxy unavailable, connecting to caster via MAVLink bridge proxy...');
            await this.connectViaBridge(config);
            return;
          }

          // Fall back to direct fetch to caster
          console.log(`[NTRIP] Attempting direct fetch to http://${host}:${port}/${mountpoint}...`);
          this.ntripAbortController = new AbortController();
          const headers: Record<string, string> = {
            'Ntrip-Version': 'Ntrip/2.0',
            'User-Agent': 'NTRIP MavlinkGlareshield/1.0',
          };
          if (config.username || config.password) {
            headers['Authorization'] = `Basic ${btoa(`${config.username || ''}:${config.password || ''}`)}`;
          }

          try {
            response = await fetch(`http://${host}:${port}/${mountpoint}`, {
              signal: this.ntripAbortController.signal,
              headers,
            });
          } catch (fetchErr: any) {
            throw new Error(
              `Caster connection failed. Browsers block direct TCP/ICY connections (CORS/ICY 200). Please start the bridge ('python3 bridge/bridge.py') or Vite dev server to stream from ${host}:${port}.`
            );
          }
        }

        if (!response || !response.ok) {
          const errText = response ? await response.text().catch(() => '') : '';
          throw new Error(`Caster connection failed (${response?.status || 'Error'}): ${errText || response?.statusText || 'Unknown error'}`);
        }

        this.updateState({ status: 'connected', source: 'ntrip' });
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Response body stream not available');

        // Start GGA feedback
        if (config.sendGga) {
          this.startGgaLoop((ggaSentence) => {
            if (usedProxy) {
              fetch(proxyUrl, {
                method: 'POST',
                body: ggaSentence,
              }).catch(() => {});
            }
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

  public async connectViaBridge(config: NtripConfig) {
    this.updateState({ status: 'connecting', source: 'ntrip', error: null });

    this.unsubBridgeText = mavlinkConnection.onText((msgStr) => {
      try {
        const msg = JSON.parse(msgStr);
        if (msg.type === 'ntrip_status') {
          if (msg.status === 'streaming') {
            this.updateState({ status: 'streaming', source: 'ntrip' });
          } else if (msg.status === 'disconnected') {
            this.updateState({ status: 'disconnected', source: 'none' });
          }
        } else if (msg.type === 'ntrip_data' && msg.data) {
          // Decode base64 binary bytes
          const binaryStr = atob(msg.data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          this.processRawStream(bytes);
        } else if (msg.type === 'ntrip_error') {
          this.updateState({ status: 'error', error: msg.message || 'Bridge NTRIP error' });
        }
      } catch {}
    });

    const sent = mavlinkConnection.sendText(
      JSON.stringify({
        type: 'ntrip_connect',
        host: config.host.trim(),
        port: config.port || 2101,
        mountpoint: config.mountpoint.trim().replace(/^\//, ''),
        username: config.username || '',
        password: config.password || '',
      })
    );

    if (!sent) {
      throw new Error('Bridge is not connected. Start the bridge using python3 bridge/bridge.py.');
    }

    this.updateState({ status: 'connected', source: 'ntrip' });

    if (config.sendGga) {
      this.startGgaLoop((gga) => {
        mavlinkConnection.sendText(JSON.stringify({ type: 'ntrip_gga', gga }));
      });
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

    if (this.unsubBridgeText) {
      this.unsubBridgeText();
      this.unsubBridgeText = null;
    }
    mavlinkConnection.sendText(JSON.stringify({ type: 'ntrip_disconnect' }));

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
    useTelemetryStore.getState().setBaseStationPosition(null);
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
