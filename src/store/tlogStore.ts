// Telemetry logging: the settings (on/off, size cap) saved in this browser, and the recorder's state for the UI.

import { create } from 'zustand';
import type { TlogMeta } from '../mavlink/tlog';

const KEY_ENABLED = 'mavlink_glareshield_tlog_enabled';
const KEY_CAP = 'mavlink_glareshield_tlog_cap_mb';
export const DEFAULT_TLOG_CAP_MB = 2048;

function read<T>(key: string, parse: (s: string) => T | undefined, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    const v = s === null ? undefined : parse(s);
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the setting lasts this session.
  }
}

export type TlogPhase =
  /** Logging is off, or there's no link. */
  | 'idle'
  /** Connected: holding what arrives until the vehicle is known, to choose the file. */
  | 'waiting'
  | 'recording'
  /** Stopped by an error (storage full, or the browser can't store files); `error` says which. */
  | 'stopped';

interface TlogState {
  enabled: boolean;
  capMb: number;
  phase: TlogPhase;
  /** The file being written, its size, and why it was chosen ("continuing after 12 s", "a different vehicle"). */
  active: string | null;
  activeBytes: number;
  decision: string | null;
  error: string | null;
  /** Kept logs and the active one already exceed the cap. */
  overCap: boolean;
  /** The logs on disk, for the list (refreshed by the recorder). */
  logs: TlogMeta[];
  setEnabled: (enabled: boolean) => void;
  setCapMb: (mb: number) => void;
}

export const useTlogStore = create<TlogState>((set) => ({
  enabled: read(KEY_ENABLED, (s) => (s === 'true' ? true : s === 'false' ? false : undefined), true),
  capMb: read(KEY_CAP, (s) => (Number.isFinite(+s) && +s >= 50 ? +s : undefined), DEFAULT_TLOG_CAP_MB),
  phase: 'idle',
  active: null,
  activeBytes: 0,
  decision: null,
  error: null,
  overCap: false,
  logs: [],
  setEnabled: (enabled) => {
    write(KEY_ENABLED, String(enabled));
    set({ enabled });
  },
  setCapMb: (mb) => {
    const capMb = Math.max(50, Math.round(mb));
    write(KEY_CAP, String(capMb));
    set({ capMb });
  },
}));
