// The desktop app's (Electron, desktop/) bridge into the page: present only there (window.glareshieldDesktop, set by
// desktop/preload.ts). The page stays the same web app; the desktop adds links a browser can't open (UDP, TCP) and
// its own updater.

export type Unsubscribe = () => void;

/** A link the desktop opens for the page: UDP (listen for the vehicle, as Mission Planner does) or a TCP client. */
export type NativeLinkConfig =
  | { kind: 'udp'; /** Local port to listen on (14550 by default). */ port: number }
  | { kind: 'tcp'; host: string; port: number }
  /** A serial port, opened by the desktop by its path (/dev/ttyACM0, COM5): found again after a replug or restart. */
  | { kind: 'serial'; path: string; baudRate: number };

export interface DesktopLinkApi {
  /** Opens the link; resolves with its ID, or rejects with a message (port in use, connection refused). */
  open(config: NativeLinkConfig): Promise<string>;
  send(id: string, data: Uint8Array): void;
  close(id: string): Promise<void>;
  onData(id: string, listener: (data: Uint8Array) => void): Unsubscribe;
  /** The link ended on its own (TCP closed, socket error): why. */
  onClosed(id: string, listener: (reason: string) => void): Unsubscribe;
}

/** A caster and mountpoint (NTRIP), reached by the desktop itself: RTK corrections without the bridge. */
export interface DesktopNtripRequest {
  host: string;
  port: number;
  mountpoint: string;
  username?: string;
  password?: string;
}

export interface DesktopNtripApi {
  /**
   * Connects and logs in for the stream `id` (the page's choice: listen on it first, as the caster's first RTCM can
   * arrive before this resolves); resolves once the caster accepts, or rejects with why not.
   */
  open(id: string, request: DesktopNtripRequest): Promise<void>;
  /** The vehicle's position for the caster (one NMEA GGA sentence). */
  sendGga(id: string, sentence: string): void;
  close(id: string): Promise<void>;
  /** RTCM from the caster. */
  onData(id: string, listener: (data: Uint8Array) => void): Unsubscribe;
  /** The stream ended on its own (the caster closed it, the network dropped): why. */
  onClosed(id: string, listener: (reason: string) => void): Unsubscribe;
}

export interface SerialPortChoice {
  portId: string;
  /** What to show: the port name and, when known, the device. */
  label: string;
}

export interface SerialPortListing {
  /** The port's path: /dev/ttyACM0, COM5. */
  path: string;
  /** What to show: its name, and the device when known (ttyACM0: ArduPilot Pixhawk6X, COM5: Silicon Labs). */
  label: string;
}

export interface DesktopSerialApi {
  /** This computer's serial ports, for the dropdown in Settings › Link. */
  list(): Promise<SerialPortListing[]>;
  /** The RTK widget's base station uses the page's Web Serial: Electron has no picker, so the page shows the list. */
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
  | { kind: 'error'; message: string }
  /** Not an installed build (run from source): no updates. */
  | { kind: 'unavailable' };

export interface DesktopUpdateApi {
  /** The latest state (kept by the main process, so a reloaded page sees a download that's ready). */
  getState(): Promise<UpdateState | null>;
  onState(listener: (state: UpdateState) => void): Unsubscribe;
  check(): void;
  /** Restart into the downloaded version. */
  install(): void;
}

export interface DesktopWindowApi {
  /** This window has no system title bar: the page draws its auto-hiding one (components/desktop/TitleBar.tsx). */
  frameless: boolean;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onMaximized(listener: (maximized: boolean) => void): Unsubscribe;
}

/** The desktop app as a bridge for phones and tablets (desktop/bridgeServer.ts). */
export interface DesktopBridgeStatus {
  enabled: boolean;
  port: number;
  listening: boolean;
  /** Why it isn't listening (the port in use), or null. */
  error: string | null;
  clients: number;
  /** This computer's LAN addresses, for the pairing link. */
  addresses: string[];
  token: string;
  /** Links this computer opened itself (UDP, TCP, serial): what the bridge relays. */
  links: number;
}

export interface DesktopBridgeApi {
  status(): Promise<DesktopBridgeStatus | null>;
  /** Turn it on or off, or change its port; resolves with the new status. */
  set(patch: { enabled?: boolean; port?: number }): Promise<DesktopBridgeStatus | null>;
  /** A new pairing token: every device has to pair again. */
  newToken(): Promise<DesktopBridgeStatus | null>;
  onStatus(listener: (status: DesktopBridgeStatus) => void): Unsubscribe;
}

/** The desktop app's own settings (kept by the main process: some apply before the page exists). */
export interface DesktopSettings {
  frameless: boolean;
}

export interface DesktopSettingsApi {
  get(): Promise<DesktopSettings | null>;
  /** Takes effect when the app restarts (a window's frame can't change while it's open). */
  setFrameless(on: boolean): Promise<void>;
  /** Restart the app (to apply a setting that needs it). */
  relaunch(): void;
}

export interface DesktopApi {
  /** The desktop app's version (package.json). */
  version: string;
  window: DesktopWindowApi;
  settings: DesktopSettingsApi;
  bridge: DesktopBridgeApi;
  platform: 'linux' | 'win32' | 'darwin' | string;
  link: DesktopLinkApi;
  ntrip: DesktopNtripApi;
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
