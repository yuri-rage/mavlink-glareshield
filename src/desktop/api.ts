// The desktop app's (Electron, desktop/) bridge into the page: present only there (window.glareshieldDesktop, set by
// desktop/preload.ts). The page stays the same web app; the desktop adds links a browser can't open (UDP, TCP) and
// its own updater.

export type Unsubscribe = () => void;

/** A link the desktop opens for the page: UDP (listen for the vehicle, as Mission Planner does) or a TCP client. */
export type NativeLinkConfig =
  | { kind: 'udp'; /** Local port to listen on (14550 by default). */ port: number }
  | { kind: 'tcp'; host: string; port: number };

export interface DesktopLinkApi {
  /** Opens the link; resolves with its ID, or rejects with a message (port in use, connection refused). */
  open(config: NativeLinkConfig): Promise<string>;
  send(id: string, data: Uint8Array): void;
  close(id: string): Promise<void>;
  onData(id: string, listener: (data: Uint8Array) => void): Unsubscribe;
  /** The link ended on its own (TCP closed, socket error): why. */
  onClosed(id: string, listener: (reason: string) => void): Unsubscribe;
}

export interface SerialPortChoice {
  portId: string;
  /** What to show: the port name and, when known, the device. */
  label: string;
}

export interface DesktopSerialApi {
  /** Electron has no serial picker of its own: the page shows one when a port is requested. */
  onChoosePort(listener: (ports: SerialPortChoice[]) => void): Unsubscribe;
  /** The page's answer: a port ID, or null (cancelled). */
  choosePort(portId: string | null): void;
}

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

export interface DesktopUpdateApi {
  onState(listener: (state: UpdateState) => void): Unsubscribe;
  check(): void;
  /** Restart into the downloaded version. */
  install(): void;
}

export interface DesktopApi {
  /** The desktop app's version (package.json). */
  version: string;
  platform: 'linux' | 'win32' | 'darwin' | string;
  link: DesktopLinkApi;
  serial: DesktopSerialApi;
  update: DesktopUpdateApi;
}

declare global {
  interface Window {
    glareshieldDesktop?: DesktopApi;
  }
}

/** The desktop API, or null in a browser. */
export function desktopApi(): DesktopApi | null {
  return (typeof window !== 'undefined' && window.glareshieldDesktop) || null;
}

export const isDesktop = (): boolean => desktopApi() !== null;
