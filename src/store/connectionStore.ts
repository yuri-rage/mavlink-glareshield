import { create } from 'zustand';
import { mavlinkConnection, ConnectionStatus, ConnectionStats } from '../mavlink/connection';
import { messageRateManager, BandwidthProfile } from '../mavlink/rateManager';

const STORAGE_KEY = 'mavlink_glareshield_ws_url';
const STORAGE_KEY_PROFILE = 'mavlink_glareshield_bandwidth_profile';
export function getDefaultWsUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname || 'localhost';
    return `ws://${host}:56781`;
  }
  return 'ws://localhost:56781';
}

export const DEFAULT_WS_URL = getDefaultWsUrl();

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
  status: ConnectionStatus;
  errorMessage?: string;
  bandwidthProfile: BandwidthProfile;
  stats: ConnectionStats;

  setUrl: (url: string) => void;
  setBandwidthProfile: (profile: BandwidthProfile) => void;
  connect: () => void;
  disconnect: () => void;
  updateStats: () => void;
}

const initialUrl = getStoredUrl();
const initialProfile = getStoredBandwidthProfile();
mavlinkConnection.setUrl(initialUrl);
messageRateManager.setProfile(initialProfile);

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  url: initialUrl,
  status: 'disconnected',
  errorMessage: undefined,
  bandwidthProfile: initialProfile,
  stats: {
    bytesReceived: 0,
    bytesSent: 0,
    packetsReceived: 0,
    packetsSent: 0,
    packetsPerSecond: 0,
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
    mavlinkConnection.setUrl(url);
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
    const { url } = get();
    mavlinkConnection.setUrl(url);
    mavlinkConnection.connect();
  },

  disconnect: () => {
    mavlinkConnection.disconnect();
  },

  updateStats: () => {
    set({ stats: { ...mavlinkConnection.stats } });
  },
}));

// Sync connection status from MavlinkConnection
mavlinkConnection.onStatus((status, error) => {
  useConnectionStore.setState({ status, errorMessage: error });
  if (status === 'connected') {
    messageRateManager.recalculateAndApply();
  }
});

// Periodic stats update
setInterval(() => {
  useConnectionStore.getState().updateStats();
}, 1000);
