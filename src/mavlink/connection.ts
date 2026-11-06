import { MavlinkParser, MavlinkPacket } from './parser';
import { MavlinkEncoder } from './encoder';
import { messageRateManager } from './rateManager';
import { MAVLINK_MSG_ID } from './messages';
import {
  WebSerialTransport,
  WebSocketTransport,
  WebUsbSerialTransport,
  getSerialApi,
  hasTextChannel,
  resolveSerialPort,
  resolveUsbSerialDevice,
  type Transport,
  type TransportStatus,
  type Unsubscribe,
} from './transport';

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

/**
 * What the MAVLink link runs over. 'serial' picks Web Serial (desktop Chrome/Edge) or WebUSB (Chrome on Android)
 * at connect time; the device itself is chosen with requestSerialDevice() from a user gesture.
 */
export type LinkConfig = { kind: 'websocket'; url: string } | { kind: 'serial'; baudRate: number };

export const DEFAULT_SERIAL_BAUD = 57600;
export const SERIAL_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 500000, 921600] as const;

/**
 * A link that is open but silent for this long is presumed dead and reopened. Browsers do not notice a
 * half-open WebSocket (Wi-Fi change, laptop or phone sleep, NAT timeout) until TCP gives up, which can take
 * minutes, so the only reliable sign is that nothing arrives. Doubles after each silent reopen, up to the max.
 */
export const LINK_SILENCE_TIMEOUT_MS = 10000;
export const LINK_SILENCE_TIMEOUT_MAX_MS = 60000;

const MIXED_CONTENT_MESSAGE =
  'Mixed Content: HTTPS pages block unencrypted ws://. Use wss:// or permit insecure WebSockets.';

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
  private link: LinkConfig;
  /** Last WebSocket URL, kept while a serial link is selected so switching back restores it. */
  private url: string;
  private transport: Transport | null = null;
  private transportSubscriptions: Unsubscribe[] = [];
  /** Bumped on every connect/disconnect so an attempt that is still resolving its device can tell it is stale. */
  private connectAttempt = 0;
  /** The attempt currently resolving its device / creating its transport, if any. */
  private openingAttempt: number | null = null;
  /** Teardown of the previous transport; a serial port must be fully closed before it can be reopened. */
  private closing: Promise<void> = Promise.resolve();
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
  /** When bytes last arrived on the current link. */
  private lastRxAt = 0;
  private silenceTimeoutMs = LINK_SILENCE_TIMEOUT_MS;

  constructor(url = getDefaultWsUrl()) {
    this.url = url;
    this.link = { kind: 'websocket', url };
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      // Coming back from sleep or a network change: check the link now rather than waiting for timers.
      let hiddenAt = 0;
      window.addEventListener('online', () => this.checkLinkNow());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') hiddenAt = Date.now();
        else if (hiddenAt && Date.now() - hiddenAt > 5000) this.checkLinkNow();
      });
    }
  }

  /**
   * Reconnect right away if the link is down and waiting to retry, or open but silent for a few seconds.
   * Called when the browser reports the network is back or the page becomes visible again.
   */
  public checkLinkNow(now = Date.now()) {
    if (this.isManualDisconnect || !this.shouldReconnect || this.isReconnectPaused) return;
    if (this.status === 'disconnected' && this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
      this.connect();
    } else if (this.status === 'connected' && now - this.lastRxAt > 3000) {
      this.handleLinkLoss('Link silent after network change; reconnecting');
    }
  }

  /** Watchdog tick (every second while connected; exposed for tests). */
  public checkLinkSilence(now = Date.now()) {
    if (this.status !== 'connected' || !this.transport) return;
    if (now - this.lastRxAt <= this.silenceTimeoutMs) return;
    const seconds = Math.round((now - this.lastRxAt) / 1000);
    this.silenceTimeoutMs = Math.min(LINK_SILENCE_TIMEOUT_MAX_MS, this.silenceTimeoutMs * 2);
    console.warn(`MAVLink link silent for ${seconds}s; reopening it.`);
    this.handleLinkLoss(`No data for ${seconds} s; reconnecting`);
  }

  /** Select a WebSocket link to this URL (reconnecting if a link is active). */
  public setUrl(url: string) {
    this.url = url;
    this.setLink({ kind: 'websocket', url });
  }

  public getUrl(): string {
    return this.url;
  }

  public setLink(link: LinkConfig) {
    if (link.kind === 'websocket') this.url = link.url;
    if (sameLink(this.link, link)) return;
    this.link = { ...link };
    if (this.status === 'connected' || this.status === 'connecting') {
      this.disconnect();
      this.connect();
    }
  }

  public getLink(): LinkConfig {
    return { ...this.link };
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

  /** Send a text frame on the bridge's side channel. False on links without one (serial) or when not open. */
  public sendText(message: string): boolean {
    const transport = this.transport;
    if (!transport || this.status !== 'connected' || !hasTextChannel(transport)) return false;
    return transport.sendText(message);
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

  private isMixedContentBlocked(): boolean {
    return (
      this.link.kind === 'websocket' &&
      typeof window !== 'undefined' &&
      window.location?.protocol === 'https:' &&
      this.link.url.startsWith('ws://') &&
      !isLoopbackWs(this.link.url)
    );
  }

  public connect() {
    this.isManualDisconnect = false;
    if (this.openingAttempt === this.connectAttempt) return;
    const current = this.transport?.getStatus().kind;
    if (current === 'connected' || current === 'connecting') return;

    // Drop any previous transport so its late events can never affect the new connection.
    this.detachTransport();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.shouldReconnect = true;
    this.setStatus('connecting');
    void this.openTransport(++this.connectAttempt);
  }

  private async openTransport(attempt: number) {
    this.openingAttempt = attempt;
    let transport: Transport;
    try {
      await this.closing;
      transport = await this.createTransport();
    } catch (e: any) {
      if (this.openingAttempt === attempt) this.openingAttempt = null;
      if (attempt === this.connectAttempt) this.handleLinkLoss(e?.message || 'Failed to connect');
      return;
    }
    if (this.openingAttempt === attempt) this.openingAttempt = null;
    if (attempt !== this.connectAttempt) {
      // disconnect() or a newer connect() happened while the device was being resolved.
      return;
    }

    this.transport = transport;
    this.transportSubscriptions = [
      transport.onFrame((chunk) => this.handleChunk(transport, chunk)),
      transport.onStatus((status) => this.handleTransportStatus(transport, status)),
    ];
    if (hasTextChannel(transport)) {
      this.transportSubscriptions.push(transport.onText((text) => this.handleText(transport, text)));
    }
    // Failures surface through the status listener above.
    transport.connect().catch(() => {});
  }

  private async createTransport(): Promise<Transport> {
    const link = this.link;
    if (link.kind === 'websocket') {
      return new WebSocketTransport('mavlink-ws', { url: link.url });
    }
    const api = getSerialApi();
    if (api === 'web-serial') {
      const port = await resolveSerialPort();
      if (!port) {
        throw new Error('Serial port not available. Plug the device in, or choose it again in Link Settings.');
      }
      return new WebSerialTransport('mavlink-serial', { baudRate: link.baudRate, port });
    }
    if (api === 'web-usb-serial') {
      const device = await resolveUsbSerialDevice();
      if (!device) {
        throw new Error('USB device not available. Plug the board in, or choose it again in Link Settings.');
      }
      return new WebUsbSerialTransport('mavlink-usb', { device });
    }
    throw new Error('This browser has no serial access. Use Chrome or Edge (desktop), or Chrome on Android.');
  }

  private handleChunk(transport: Transport, chunk: Uint8Array) {
    if (this.transport !== transport) return;
    this.stats.bytesReceived += chunk.length;
    this.lastRxAt = Date.now();
    this.silenceTimeoutMs = LINK_SILENCE_TIMEOUT_MS;

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

  private handleText(transport: Transport, text: string) {
    if (this.transport !== transport) return;
    this.textListeners.forEach((listener) => {
      try {
        listener(text);
      } catch (err) {
        console.error('Error in text listener:', err);
      }
    });
  }

  private handleTransportStatus(transport: Transport, status: TransportStatus) {
    if (this.transport !== transport) return;
    switch (status.kind) {
      case 'connected':
        this.lastRxAt = Date.now();
        this.setStatus('connected');
        this.startHeartbeat();
        this.startStats();
        messageRateManager.resetCache();
        try {
          const req = this.encoder.createRequestMessage(1, 1, MAVLINK_MSG_ID.AUTOPILOT_VERSION);
          this.send(req);
        } catch {}
        break;
      case 'error':
        console.warn(`MAVLink ${transport.kind} link error:`, status.message);
        this.handleLinkLoss(this.isMixedContentBlocked() ? MIXED_CONTENT_MESSAGE : this.describeError(status.message));
        break;
      case 'disconnected':
        this.handleLinkLoss();
        break;
      default:
        break;
    }
  }

  private describeError(message: string): string {
    return this.link.kind === 'websocket' ? 'WebSocket error occurred' : message;
  }

  /** The link failed or closed on its own: report it, tear down, and schedule a reconnect (as before). */
  private handleLinkLoss(error?: string) {
    this.detachTransport();
    this.cleanup();
    if (error) this.setStatus('error', error);
    this.setStatus('disconnected');
    if (this.shouldReconnect && !this.isReconnectPaused) {
      // If blocked by browser mixed content, back off to 10s to avoid spamming the console
      const delay = this.isMixedContentBlocked() ? 10000 : 2000;
      this.reconnectTimeout = setTimeout(() => this.connect(), delay);
    }
  }

  private detachTransport() {
    this.transportSubscriptions.forEach((unsubscribe) => unsubscribe());
    this.transportSubscriptions = [];
    const transport = this.transport;
    this.transport = null;
    if (transport) {
      const previous = this.closing;
      this.closing = previous.then(() => transport.disconnect()).catch(() => {});
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
    if (this.shouldReconnect && this.status === 'disconnected' && !this.transport && this.openingAttempt === null) {
      this.connect();
    }
  }

  public disconnect() {
    this.isManualDisconnect = true;
    this.shouldReconnect = false;
    this.connectAttempt++;
    this.cleanup();
    this.detachTransport();
    this.setStatus('disconnected');
  }

  public send(data: Uint8Array): boolean {
    const transport = this.transport;
    if (!transport || this.status !== 'connected') return false;
    transport.send(data).catch((err) => {
      console.error('Failed to send MAVLink data:', err);
    });
    this.stats.bytesSent += data.length;
    this.stats.packetsSent++;
    this.sendListeners.forEach((cb) => {
      try {
        cb(data);
      } catch {}
    });
    return true;
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
      this.checkLinkSilence();
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

function sameLink(a: LinkConfig, b: LinkConfig): boolean {
  if (a.kind === 'websocket' && b.kind === 'websocket') return a.url === b.url;
  if (a.kind === 'serial' && b.kind === 'serial') return a.baudRate === b.baudRate;
  return false;
}

// Global connection instance singleton
export const mavlinkConnection = new MavlinkConnection();
