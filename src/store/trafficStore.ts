// ADS-B traffic currently known (mavlink/adsb.ts), keyed by ICAO address. Reports older than TRAFFIC_EXPIRE_MS drop.

import { create } from 'zustand';
import { TRAFFIC_EXPIRE_MS, type TrafficAircraft } from '../mavlink/adsb';

interface TrafficState {
  aircraft: Record<number, TrafficAircraft>;
  upsert: (a: TrafficAircraft) => void;
  /** Drop expired reports; returns whether anything was dropped. */
  prune: (nowMs: number) => boolean;
  clear: () => void;
}

export const useTrafficStore = create<TrafficState>((set, get) => ({
  aircraft: {},
  upsert: (a) => {
    const prev = get().aircraft[a.icao];
    // A report the receiver heard earlier than the one held (they arrive out of order across links): keep the newer.
    if (prev && prev.heardAtMs > a.heardAtMs) return;
    set({ aircraft: { ...get().aircraft, [a.icao]: a } });
  },
  prune: (nowMs) => {
    const cur = get().aircraft;
    const keep = Object.values(cur).filter((a) => nowMs - a.heardAtMs < TRAFFIC_EXPIRE_MS);
    if (keep.length === Object.keys(cur).length) return false;
    set({ aircraft: Object.fromEntries(keep.map((a) => [a.icao, a])) });
    return true;
  },
  clear: () => set({ aircraft: {} }),
}));
