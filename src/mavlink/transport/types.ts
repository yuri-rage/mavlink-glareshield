// Byte-stream transports for the MAVLink link.
//
// Adapted from ArduConfigurator (https://github.com/j-w9/arduconfigurator), packages/transport/src/types.ts
// at commit e3f4571, GPL-3.0-only. Modified for Glareshield: dropped the transport kinds Glareshield does not
// ship (mock, native serial, TCP/UDP Direct Sockets, replay) and added the optional TextChannel extension used
// by the companion bridge's JSON side channel (NTRIP via bridge).

export type Unsubscribe = () => void;

export type TransportKind =
  | 'websocket'
  | 'web-serial'
  // Serial over WebUSB, for platforms with no Web Serial API (Android).
  | 'web-usb-serial';

export type TransportStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'disconnected'; reason?: string }
  | { kind: 'error'; message: string };

export type FrameListener = (frame: Uint8Array) => void;
export type StatusListener = (status: TransportStatus) => void;
export type TextListener = (message: string) => void;

export interface Transport {
  readonly id: string;
  readonly kind: TransportKind;
  getStatus(): TransportStatus;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(frame: Uint8Array): Promise<void>;
  onFrame(listener: FrameListener): Unsubscribe;
  onStatus(listener: StatusListener): Unsubscribe;
}

/**
 * Optional text side channel. Only the WebSocket transport has one: the companion bridge exchanges JSON control
 * messages (NTRIP relay) as WebSocket text frames alongside binary MAVLink frames. Serial links have no equivalent.
 */
export interface TextChannel {
  onText(listener: TextListener): Unsubscribe;
  /** Returns false when the channel is not open; never throws. */
  sendText(message: string): boolean;
}

export function hasTextChannel(transport: Transport): transport is Transport & TextChannel {
  const candidate = transport as Partial<TextChannel>;
  return typeof candidate.onText === 'function' && typeof candidate.sendText === 'function';
}
