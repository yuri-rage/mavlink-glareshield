import { MavlinkParser, MavlinkPacket } from './parser';
import { MavlinkEncoder } from './encoder';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectionStats {
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsSent: number;
  packetsPerSecond: number;
}

export type PacketCallback = (packet: MavlinkPacket) => void;
export type StatusCallback = (status: ConnectionStatus, error?: string) => void;

export class MavlinkConnection {
  private ws: WebSocket | null = null;
  private url: string;
  private parser: MavlinkParser = new MavlinkParser();
  private encoder: MavlinkEncoder = new MavlinkEncoder();
  private packetListeners: Set<PacketCallback> = new Set();
  private statusListeners: Set<StatusCallback> = new Set();

  private status: ConnectionStatus = 'disconnected';
  private shouldReconnect = true;
  private reconnectTimeout: any = null;
  private heartbeatInterval: any = null;
  private statsInterval: any = null;

  public stats: ConnectionStats = {
    bytesReceived: 0,
    bytesSent: 0,
    packetsReceived: 0,
    packetsSent: 0,
    packetsPerSecond: 0,
  };
  private lastPacketCount = 0;

  constructor(url = 'ws://10.69.69.213:56781') {
    this.url = url;
  }

  public setUrl(url: string) {
    if (this.url !== url) {
      this.url = url;
      if (this.status === 'connected' || this.status === 'connecting') {
        this.disconnect();
        this.connect();
      }
    }
  }

  public getUrl(): string {
    return this.url;
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public getEncoder(): MavlinkEncoder {
    return this.encoder;
  }

  public onPacket(callback: PacketCallback): () => void {
    this.packetListeners.add(callback);
    return () => this.packetListeners.delete(callback);
  }

  public onStatus(callback: StatusCallback): () => void {
    this.statusListeners.add(callback);
    callback(this.status);
    return () => this.statusListeners.delete(callback);
  }

  private setStatus(status: ConnectionStatus, error?: string) {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status, error));
  }

  public connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.shouldReconnect = true;
    this.setStatus('connecting');

    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        this.setStatus('connected');
        this.startHeartbeat();
        this.startStats();
        try {
          const req = this.encoder.createRequestAutopilotVersion();
          this.send(req);
        } catch {}
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
          const chunk = new Uint8Array(event.data);
          this.stats.bytesReceived += chunk.length;

          const packets = this.parser.parse(chunk);
          this.stats.packetsReceived += packets.length;

          for (const packet of packets) {
            this.packetListeners.forEach((listener) => {
              try {
                listener(packet);
              } catch (err) {
                console.error('Error in packet listener:', err);
              }
            });
          }
        }
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket connection error:', err);
        this.setStatus('error', 'WebSocket error occurred');
      };

      this.ws.onclose = () => {
        this.cleanup();
        this.setStatus('disconnected');
        if (this.shouldReconnect) {
          this.reconnectTimeout = setTimeout(() => this.connect(), 2000);
        }
      };
    } catch (e: any) {
      this.setStatus('error', e?.message || 'Failed to connect');
      if (this.shouldReconnect) {
        this.reconnectTimeout = setTimeout(() => this.connect(), 3000);
      }
    }
  }

  public disconnect() {
    this.shouldReconnect = false;
    this.cleanup();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  public send(data: Uint8Array): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(data);
        this.stats.bytesSent += data.length;
        this.stats.packetsSent++;
        return true;
      } catch (err) {
        console.error('Failed to send MAVLink data:', err);
        return false;
      }
    }
    return false;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      const hb = this.encoder.createHeartbeat();
      this.send(hb);
    }, 1000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private startStats() {
    this.stopStats();
    this.lastPacketCount = this.stats.packetsReceived;
    this.statsInterval = setInterval(() => {
      const diff = this.stats.packetsReceived - this.lastPacketCount;
      this.lastPacketCount = this.stats.packetsReceived;
      this.stats.packetsPerSecond = diff;
    }, 1000);
  }

  private stopStats() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  private cleanup() {
    this.stopHeartbeat();
    this.stopStats();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}

// Global connection instance singleton
export const mavlinkConnection = new MavlinkConnection();
