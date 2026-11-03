import { MavlinkParser, MavlinkPacket } from './parser';
import { MavlinkEncoder } from './encoder';
import { messageRateManager } from './rateManager';

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
export type SendCallback = (data: Uint8Array) => void;

export function getDefaultWsUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname || 'localhost';
    return `ws://${host}:56781`;
  }
  return 'ws://localhost:56781';
}

/**
 * Checks if a WebSocket URL points to a loopback address (localhost, 127.x.x.x, [::1]).
 * Modern browsers permit unencrypted ws:// connections to loopback hosts even when
 * the page is loaded over HTTPS.
 */
export function isLoopbackWs(url: string): boolean {
  try {
    const parsed = new URL(url);
    const h = parsed.hostname.toLowerCase();
    return (
      h === 'localhost' ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
      h === '[::1]' ||
      h === '::1'
    );
  } catch {
    return /^ws:\/\/(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[?::1\]?)(:\d+)?(\/.*)?$/i.test(url.trim());
  }
}

/**
 * Extracts the host (hostname and port) from a wss:// URL for certificate authorization,
 * safely ignoring any paths, queries (?token=...), or authentication credentials.
 */
export function getWssHost(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith('wss://')) return null;
  try {
    return new URL(trimmed).host || null;
  } catch {
    const match = trimmed.match(/^wss:\/\/([^/?#]+)/i);
    return match ? match[1] : null;
  }
}

export class MavlinkConnection {
  private ws: WebSocket | null = null;
  private url: string;
  private parser: MavlinkParser = new MavlinkParser();
  private encoder: MavlinkEncoder = new MavlinkEncoder();
  private packetListeners: Set<PacketCallback> = new Set();
  private statusListeners: Set<StatusCallback> = new Set();
  private sendListeners: Set<SendCallback> = new Set();
  private textListeners: Set<(msg: string) => void> = new Set();

  private status: ConnectionStatus = 'disconnected';
  private shouldReconnect = true;
  public isManualDisconnect = false;
  private isReconnectPaused = false;
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

  constructor(url = getDefaultWsUrl()) {
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

  public onSend(callback: SendCallback): () => void {
    this.sendListeners.add(callback);
    return () => {
      this.sendListeners.delete(callback);
    };
  }

  public onText(callback: (msg: string) => void): () => void {
    this.textListeners.add(callback);
    return () => this.textListeners.delete(callback);
  }

  public sendText(message: string): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
      return true;
    }
    return false;
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
    this.isManualDisconnect = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // Clean up any existing socket listeners so old events can never affect the new connection
    if (this.ws) {
      const prevWs = this.ws;
      this.ws = null;
      prevWs.onopen = null;
      prevWs.onmessage = null;
      prevWs.onerror = null;
      prevWs.onclose = null;
      try {
        prevWs.close();
      } catch {}
    }

    this.shouldReconnect = true;
    this.setStatus('connecting');

    try {
      const socket = new WebSocket(this.url);
      this.ws = socket;
      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        if (this.ws !== socket) return;
        this.setStatus('connected');
        this.startHeartbeat();
        this.startStats();
        messageRateManager.resetCache();
        try {
          const req = this.encoder.createRequestAutopilotVersion();
          this.send(req);
        } catch {}
      };

      socket.onmessage = (event: MessageEvent) => {
        if (this.ws !== socket) return;
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
        } else if (typeof event.data === 'string') {
          this.textListeners.forEach((listener) => {
            try {
              listener(event.data as string);
            } catch (err) {
              console.error('Error in text listener:', err);
            }
          });
        }
      };

      socket.onerror = (err) => {
        if (this.ws !== socket) return;
        console.warn('WebSocket connection error:', err);
        const isMixedContent =
          typeof window !== 'undefined' &&
          window.location.protocol === 'https:' &&
          this.url.startsWith('ws://') &&
          !isLoopbackWs(this.url);
        const errMsg = isMixedContent
          ? 'Mixed Content: HTTPS pages block unencrypted ws://. Use wss:// or permit insecure WebSockets.'
          : 'WebSocket error occurred';
        this.setStatus('error', errMsg);
      };

      socket.onclose = () => {
        if (this.ws !== socket) return;
        this.ws = null;
        this.cleanup();
        this.setStatus('disconnected');
        if (this.shouldReconnect && !this.isReconnectPaused) {
          const isMixedContent =
            typeof window !== 'undefined' &&
            window.location.protocol === 'https:' &&
            this.url.startsWith('ws://') &&
            !isLoopbackWs(this.url);
          // If blocked by browser mixed content, back off to 10s to avoid spamming the console
          const delay = isMixedContent ? 10000 : 2000;
          this.reconnectTimeout = setTimeout(() => this.connect(), delay);
        }
      };
    } catch (e: any) {
      const isMixedContent =
        typeof window !== 'undefined' &&
        window.location.protocol === 'https:' &&
        this.url.startsWith('ws://') &&
        !isLoopbackWs(this.url);
      const msg = isMixedContent
        ? 'Mixed Content: HTTPS pages block unencrypted ws://. Use wss:// or permit insecure WebSockets.'
        : e?.message || 'Failed to connect';
      this.setStatus('error', msg);
      if (this.shouldReconnect && !this.isReconnectPaused) {
        const delay = isMixedContent ? 10000 : 3000;
        this.reconnectTimeout = setTimeout(() => this.connect(), delay);
      }
    }
  }

  /**
   * Pauses automatic reconnect attempts (e.g. while user is editing connection settings in modal).
   */
  public pauseReconnect() {
    this.isReconnectPaused = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Resumes automatic reconnect attempts after connection settings modal closes.
   */
  public resumeReconnect() {
    this.isReconnectPaused = false;
    const isSocketInactive = !this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING;
    if (this.shouldReconnect && this.status === 'disconnected' && isSocketInactive) {
      this.connect();
    }
  }

  public disconnect() {
    this.isManualDisconnect = true;
    this.shouldReconnect = false;
    this.cleanup();
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {}
    }
    this.setStatus('disconnected');
  }

  public send(data: Uint8Array): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(data);
        this.stats.bytesSent += data.length;
        this.stats.packetsSent++;
        this.sendListeners.forEach((cb) => {
          try {
            cb(data);
          } catch {}
        });
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
