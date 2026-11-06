// WebSocket transport (Mission Planner's /websocket/raw server, bridge/bridge.py, or any MAVLink WebSocket).
//
// Adapted from ArduConfigurator (https://github.com/j-w9/arduconfigurator),
// packages/transport/src/websocket-transport.ts at commit e3f4571, GPL-3.0-only. Modified for Glareshield:
//   - text frames go to a separate TextChannel (onText/sendText) instead of being UTF-8 encoded into the
//     binary frame stream, so the bridge's JSON control messages never reach the MAVLink parser;
//   - a socket factory that throws (e.g. a malformed URL) ends in an 'error' status instead of leaving the
//     transport stuck in 'connecting';
//   - the close event that follows a runtime error is reported as 'disconnected' with its close reason.

import type {
  FrameListener,
  StatusListener,
  TextChannel,
  TextListener,
  Transport,
  TransportStatus,
  Unsubscribe,
} from './types';

export interface WebSocketLike {
  binaryType: BinaryType;
  readonly readyState: number;
  send(data: Uint8Array | ArrayBuffer | string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: (event: Event) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  addEventListener(type: 'close', listener: (event: CloseEvent) => void): void;
  removeEventListener(type: 'open', listener: (event: Event) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'error', listener: (event: Event) => void): void;
  removeEventListener(type: 'close', listener: (event: CloseEvent) => void): void;
}

export interface WebSocketTransportOptions {
  url: string;
  protocols?: string | string[];
  socketFactory?: (url: string, protocols?: string | string[]) => WebSocketLike;
}

const SOCKET_OPEN_READY_STATE = 1;

export class WebSocketTransport implements Transport, TextChannel {
  readonly kind = 'websocket' as const;
  readonly id: string;

  private readonly frameListeners = new Set<FrameListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly textListeners = new Set<TextListener>();
  private readonly options: WebSocketTransportOptions;

  private status: TransportStatus = { kind: 'idle' };
  private socket?: WebSocketLike;
  private connectReject?: (error: Error) => void;
  /**
   * Detacher for the connect-phase listeners (open/error/close-before-open), lifted out of the Promise closure
   * so disconnect() can call it directly and stop a late close event from clobbering a follow-up reconnect.
   */
  private cleanupConnectListeners?: () => void;
  /** Idempotency latch so concurrent connect() calls share one attempt instead of opening a second socket. */
  private pendingConnectPromise?: Promise<void>;

  private readonly handleMessage = (event: MessageEvent) => {
    void this.forwardMessage(event.data);
  };

  private readonly handleRuntimeError = () => {
    if (this.status.kind === 'connected' || this.status.kind === 'connecting') {
      this.updateStatus({ kind: 'error', message: `WebSocket transport ${this.id} encountered an error.` });
    }
  };

  private readonly handleRuntimeClose = (event: CloseEvent) => {
    if (this.status.kind === 'disconnected') {
      return;
    }
    this.updateStatus({ kind: 'disconnected', reason: event.reason || `WebSocket closed (${event.code})` });
  };

  constructor(id = 'websocket', options: WebSocketTransportOptions) {
    this.id = id;
    this.options = options;
  }

  static isSupported(): boolean {
    return typeof globalThis.WebSocket === 'function';
  }

  getUrl(): string {
    return this.options.url;
  }

  getStatus(): TransportStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    if (this.status.kind === 'connected') {
      return;
    }
    if (this.pendingConnectPromise) {
      return this.pendingConnectPromise;
    }

    const socketFactory = this.options.socketFactory ?? defaultSocketFactory;
    this.updateStatus({ kind: 'connecting' });

    const promise = new Promise<void>((resolve, reject) => {
      let socket: WebSocketLike;
      try {
        socket = socketFactory(this.options.url, this.options.protocols);
      } catch (error) {
        const message = error instanceof Error ? error.message : `Failed to open WebSocket ${this.options.url}.`;
        this.updateStatus({ kind: 'error', message });
        reject(error instanceof Error ? error : new Error(message));
        return;
      }
      this.socket = socket;
      socket.binaryType = 'arraybuffer';

      const cleanupConnectListeners = () => {
        this.connectReject = undefined;
        this.cleanupConnectListeners = undefined;
        socket.removeEventListener('open', handleOpen);
        socket.removeEventListener('error', handleError);
        socket.removeEventListener('close', handleCloseBeforeOpen);
      };

      // Let disconnect() settle this promise if it is called while the socket is still opening.
      this.connectReject = reject;
      this.cleanupConnectListeners = cleanupConnectListeners;

      const handleOpen = () => {
        cleanupConnectListeners();
        socket.addEventListener('message', this.handleMessage);
        socket.addEventListener('error', this.handleRuntimeError);
        socket.addEventListener('close', this.handleRuntimeClose);
        this.updateStatus({ kind: 'connected' });
        resolve();
      };

      const handleError = () => {
        cleanupConnectListeners();
        const message = `Failed to open WebSocket ${this.options.url}.`;
        this.updateStatus({ kind: 'error', message });
        reject(new Error(message));
      };

      const handleCloseBeforeOpen = (event: CloseEvent) => {
        cleanupConnectListeners();
        const reason = event.reason || `WebSocket closed before opening (${event.code})`;
        this.updateStatus({ kind: 'disconnected', reason });
        reject(new Error(reason));
      };

      socket.addEventListener('open', handleOpen);
      socket.addEventListener('error', handleError);
      socket.addEventListener('close', handleCloseBeforeOpen);
    });

    this.pendingConnectPromise = promise.finally(() => {
      this.pendingConnectPromise = undefined;
    });
    return this.pendingConnectPromise;
  }

  async disconnect(): Promise<void> {
    if (!this.socket) {
      this.updateStatus({ kind: 'disconnected', reason: 'WebSocket already closed.' });
      return;
    }

    const socket = this.socket;
    this.detachRuntimeListeners(socket);
    // Capture the pending reject before detaching: cleanupConnectListeners clears it.
    const pendingReject = this.connectReject;
    this.connectReject = undefined;
    this.cleanupConnectListeners?.();
    this.socket = undefined;
    if (pendingReject) {
      pendingReject(new Error('WebSocket connect aborted by disconnect.'));
    }
    try {
      socket.close(1000, 'Requested disconnect');
    } catch {
      // Already closing or closed.
    }
    this.updateStatus({ kind: 'disconnected', reason: 'WebSocket closed.' });
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN_READY_STATE) {
      throw new Error('WebSocketTransport is not connected.');
    }
    this.socket.send(frame);
  }

  sendText(message: string): boolean {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN_READY_STATE) {
      return false;
    }
    try {
      this.socket.send(message);
      return true;
    } catch {
      return false;
    }
  }

  onFrame(listener: FrameListener): Unsubscribe {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  onText(listener: TextListener): Unsubscribe {
    this.textListeners.add(listener);
    return () => {
      this.textListeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private detachRuntimeListeners(socket: WebSocketLike): void {
    socket.removeEventListener('message', this.handleMessage);
    socket.removeEventListener('error', this.handleRuntimeError);
    socket.removeEventListener('close', this.handleRuntimeClose);
  }

  private async forwardMessage(data: unknown): Promise<void> {
    if (typeof data === 'string') {
      this.textListeners.forEach((listener) => listener(data));
      return;
    }
    // binaryType is 'arraybuffer', so frames are handled synchronously and stay in arrival order. Only a Blob
    // (a socket factory that ignores binaryType) needs the async read.
    const frame =
      typeof Blob !== 'undefined' && data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : toBytes(data);
    if (!frame) {
      return;
    }
    this.frameListeners.forEach((listener) => listener(frame));
  }

  private updateStatus(status: TransportStatus): void {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }
}

function defaultSocketFactory(url: string, protocols?: string | string[]): WebSocketLike {
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('WebSocket is not available in this environment.');
  }
  return new globalThis.WebSocket(url, protocols) as unknown as WebSocketLike;
}

function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return undefined;
}
