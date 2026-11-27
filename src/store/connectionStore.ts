import { create } from 'zustand';

import { desktopApi } from '../desktop/api';
// The bridge's default address lives with the connection; re-exported for existing imports.
import {
  ConnectionStats,
  ConnectionStatus,
  DEFAULT_SERIAL_BAUD,
  getDefaultWsUrl,
  mavlinkConnection,
  type LinkConfig,
} from '../mavlink/connection';
import { BandwidthProfile, messageRateManager } from '../mavlink/rateManager';

const STORAGE_KEY = 'mavlink_glareshield_ws_url';
const STORAGE_KEY_PROFILE = 'mavlink_glareshield_bandwidth_profile';
const STORAGE_KEY_GCS_SYSID = 'mavlink_glareshield_gcs_sysid';
const STORAGE_KEY_LINK_KIND = 'mavlink_glareshield_link_kind';
const STORAGE_KEY_SERIAL_BAUD = 'mavlink_glareshield_serial_baud';
const STORAGE_KEY_UDP_PORT = 'mavlink_glareshield_udp_port';
const STORAGE_KEY_TCP_TARGET = 'mavlink_glareshield_tcp_target';
const STORAGE_KEY_SERIAL_PATH = 'mavlink_glareshield_serial_path';

/** The desktop app's UDP link listens here by default (where ArduPilot, SITL and most radios' bridges send). */
export const DEFAULT_UDP_PORT = 14550;
/** The desktop app's TCP link's default: SITL's first serial port. */
export const DEFAULT_TCP_TARGET = '127.0.0.1:5760';

export type LinkKind = LinkConfig['kind'];

export { getDefaultWsUrl };

function getStoredUrl(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && saved.trim()) {
        return normalizeWsUrl(saved.trim());
      }
    }
  } catch (e) {
    console.warn('Failed to read stored WebSocket URL:', e);
  }
  return getDefaultWsUrl();
}

function getStoredBandwidthProfile(): BandwidthProfile {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY_PROFILE);
      if (saved === 'low' || saved === 'standard' || saved === 'high') {
        return saved;
      }
    }
  } catch (e) {
    console.warn('Failed to read stored bandwidth profile:', e);
  }
  return 'standard';
}

function getStoredGcsSystemId(): number {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY_GCS_SYSID);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (parsed > 0 && parsed <= 255) {
          return parsed;
        }
      }
    }
  } catch (e) {
    console.warn('Failed to read stored GCS sysid:', e);
  }
  return 255;
}

function getStoredLinkKind(): LinkKind {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY_LINK_KIND) : null;
    if (saved === 'serial') return 'serial';
    // UDP and TCP only where they can open (the desktop app); a browser falls back to the bridge.
    if ((saved === 'udp' || saved === 'tcp') && desktopApi()) return saved;
  } catch {}
  return 'websocket';
}

function getStoredString(key: string, fallback: string): string {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (v && v.trim()) return v.trim();
  } catch {}
  return fallback;
}

/** "host:port" (or a bare host, on port 5760) for the TCP link. */
export function parseTcpTarget(target: string): { host: string; port: number } {
  const t = target.trim() || DEFAULT_TCP_TARGET;
  const at = t.lastIndexOf(':');
  const port = at > 0 ? parseInt(t.slice(at + 1), 10) : NaN;
  if (at > 0 && port > 0 && port < 65536) return { host: t.slice(0, at), port };
  return { host: at > 0 ? t.slice(0, at) : t, port: 5760 };
}

function getStoredSerialBaud(): number {
  try {
    if (typeof localStorage !== 'undefined') {
      const parsed = parseInt(localStorage.getItem(STORAGE_KEY_SERIAL_BAUD) || '', 10);
      if (parsed > 0) return parsed;
    }
  } catch {}
  return DEFAULT_SERIAL_BAUD;
}

function storeValue(key: string, value: string) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`Failed to save ${key}:`, e);
  }
}

export function buildLinkConfig(
  linkKind: LinkKind,
  url: string,
  serialBaud: number,
  native: { udpPort: number; tcpTarget: string; serialPath?: string } = {
    udpPort: DEFAULT_UDP_PORT,
    tcpTarget: DEFAULT_TCP_TARGET,
  }
): LinkConfig {
  if (linkKind === 'serial')
    return native.serialPath
      ? { kind: 'serial', baudRate: serialBaud, path: native.serialPath }
      : { kind: 'serial', baudRate: serialBaud };
  if (linkKind === 'udp') return { kind: 'udp', port: native.udpPort };
  if (linkKind === 'tcp') return { kind: 'tcp', ...parseTcpTarget(native.tcpTarget) };
  return { kind: 'websocket', url };
}

const linkOf = (s: {
  linkKind: LinkKind;
  url: string;
  serialBaud: number;
  udpPort: number;
  tcpTarget: string;
  serialPath: string;
}) => buildLinkConfig(s.linkKind, s.url, s.serialBaud, s);

export function normalizeWsUrl(input: string): string {
  let url = input.trim();
  if (!url) return getDefaultWsUrl();
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    url = `ws://${url}`;
  }
  return url;
}

interface ConnectionState {
  url: string;
  /** WebSocket (bridge / Mission Planner) or a USB serial device opened by the browser. */
  linkKind: LinkKind;
  serialBaud: number;
  /** The desktop app's UDP link: the local port it listens on. */
  udpPort: number;
  /** The desktop app's TCP link: host:port. */
  tcpTarget: string;
  /** The desktop app's serial port, by path (/dev/ttyACM0, COM5); empty in a browser. */
  serialPath: string;
  status: ConnectionStatus;
  errorMessage?: string;
  bandwidthProfile: BandwidthProfile;
  gcsSystemId: number;
  stats: ConnectionStats;

  setUrl: (url: string) => void;
  setLinkKind: (kind: LinkKind) => void;
  setSerialBaud: (baud: number) => void;
  setUdpPort: (port: number) => void;
  setTcpTarget: (target: string) => void;
  setSerialPath: (path: string) => void;
  setBandwidthProfile: (profile: BandwidthProfile) => void;
  setGcsSystemId: (sysId: number) => void;
  connect: () => void;
  disconnect: () => void;
  updateStats: () => void;
}

const initialUrl = getStoredUrl();
const initialProfile = getStoredBandwidthProfile();
const initialGcsSysId = getStoredGcsSystemId();
const initialLinkKind = getStoredLinkKind();
const initialSerialBaud = getStoredSerialBaud();
const initialUdpPort =
  parseInt(getStoredString(STORAGE_KEY_UDP_PORT, String(DEFAULT_UDP_PORT)), 10) || DEFAULT_UDP_PORT;
const initialTcpTarget = getStoredString(STORAGE_KEY_TCP_TARGET, DEFAULT_TCP_TARGET);
const initialSerialPath = getStoredString(STORAGE_KEY_SERIAL_PATH, '');
mavlinkConnection.setUrl(initialUrl);
mavlinkConnection.setLink(
  buildLinkConfig(initialLinkKind, initialUrl, initialSerialBaud, {
    udpPort: initialUdpPort,
    tcpTarget: initialTcpTarget,
    serialPath: initialSerialPath,
  })
);
messageRateManager.setProfile(initialProfile);
mavlinkConnection.getEncoder().setSourceId(initialGcsSysId);

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  url: initialUrl,
  linkKind: initialLinkKind,
  serialBaud: initialSerialBaud,
  udpPort: initialUdpPort,
  tcpTarget: initialTcpTarget,
  serialPath: initialSerialPath,
  status: 'disconnected',
  errorMessage: undefined,
  bandwidthProfile: initialProfile,
  gcsSystemId: initialGcsSysId,
  stats: {
    bytesReceived: 0,
    bytesSent: 0,
    packetsReceived: 0,
    packetsSent: 0,
    packetsPerSecond: 0,
    sendsBlocked: 0,
  },

  setGcsSystemId: (sysId: number) => {
    const validId = Math.max(1, Math.min(255, Math.round(sysId)));
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_GCS_SYSID, validId.toString());
      }
    } catch (e) {
      console.warn('Failed to save GCS sysid:', e);
    }
    set({ gcsSystemId: validId });
    mavlinkConnection.getEncoder().setSourceId(validId);
  },

  setUrl: (rawUrl: string) => {
    const url = normalizeWsUrl(rawUrl);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, url);
      }
    } catch (e) {
      console.warn('Failed to save WebSocket URL:', e);
    }
    set({ url });
    if (get().linkKind === 'websocket') mavlinkConnection.setUrl(url);
  },

  setLinkKind: (linkKind: LinkKind) => {
    storeValue(STORAGE_KEY_LINK_KIND, linkKind);
    set({ linkKind });
    mavlinkConnection.setLink(linkOf(get()));
  },

  setUdpPort: (port: number) => {
    const udpPort = Math.round(port) > 0 && Math.round(port) < 65536 ? Math.round(port) : DEFAULT_UDP_PORT;
    storeValue(STORAGE_KEY_UDP_PORT, String(udpPort));
    set({ udpPort });
    mavlinkConnection.setLink(linkOf(get()));
  },

  setSerialPath: (serialPath: string) => {
    storeValue(STORAGE_KEY_SERIAL_PATH, serialPath);
    set({ serialPath });
    mavlinkConnection.setLink(linkOf(get()));
  },

  setTcpTarget: (target: string) => {
    const t = parseTcpTarget(target);
    const tcpTarget = `${t.host}:${t.port}`;
    storeValue(STORAGE_KEY_TCP_TARGET, tcpTarget);
    set({ tcpTarget });
    mavlinkConnection.setLink(linkOf(get()));
  },

  setSerialBaud: (baud: number) => {
    const serialBaud = Math.max(1, Math.round(baud)) || DEFAULT_SERIAL_BAUD;
    storeValue(STORAGE_KEY_SERIAL_BAUD, String(serialBaud));
    set({ serialBaud });
    mavlinkConnection.setLink(linkOf(get()));
  },

  setBandwidthProfile: (profile: BandwidthProfile) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_PROFILE, profile);
      }
    } catch (e) {
      console.warn('Failed to save bandwidth profile:', e);
    }
    set({ bandwidthProfile: profile });
    messageRateManager.setProfile(profile);
  },

  connect: () => {
    set({ errorMessage: undefined });
    mavlinkConnection.setLink(linkOf(get()));
    mavlinkConnection.connect();
  },

  disconnect: () => {
    set({ errorMessage: undefined });
    mavlinkConnection.disconnect();
  },

  updateStats: () => {
    set({ stats: { ...mavlinkConnection.stats } });
  },
}));

// Sync connection status from MavlinkConnection
mavlinkConnection.onStatus((status, error) => {
  // A failed attempt is followed at once by 'disconnected' (and a retry's 'connecting'): its error stays shown until
  // the link connects, or the person connects or disconnects themselves, instead of vanishing before it's read.
  useConnectionStore.setState((s) => ({
    status,
    errorMessage: error ?? (status === 'connected' ? undefined : s.errorMessage),
  }));
  if (status === 'connected') {
    messageRateManager.recalculateAndApply();
  }
});

// Periodic stats update
setInterval(() => {
  useConnectionStore.getState().updateStats();
}, 1000);
