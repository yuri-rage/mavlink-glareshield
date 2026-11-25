// ADS-B traffic settings, saved in this browser: whether aircraft are drawn on the map, whether threats are warned
// of (banner and spoken alert), and the thresholds that make an aircraft a caution or an alert (mavlink/adsb.ts).
// Drawing and warning are separate on purpose: hiding the symbols to declutter the map doesn't silence warnings.

import { create } from 'zustand';

import { DEFAULT_THRESHOLDS, type TrafficThresholds } from '../mavlink/adsb';

const KEY = 'mavlink_glareshield_adsb';

/** Lower bounds, so a typo can't turn the checks off or make every aircraft an alert by accident. */
const MIN: TrafficThresholds = {
  cautionRangeM: 50,
  cautionVerticalM: 10,
  alertRangeM: 50,
  alertVerticalM: 10,
  cpaAlertM: 10,
  cpaHorizonS: 5,
};
const MAX: TrafficThresholds = {
  cautionRangeM: 100_000,
  cautionVerticalM: 10_000,
  alertRangeM: 100_000,
  alertVerticalM: 10_000,
  cpaAlertM: 20_000,
  cpaHorizonS: 600,
};

export function clampThresholds(t: Partial<TrafficThresholds>): TrafficThresholds {
  const out = { ...DEFAULT_THRESHOLDS };
  for (const k of Object.keys(DEFAULT_THRESHOLDS) as (keyof TrafficThresholds)[]) {
    const v = Number(t[k]);
    if (Number.isFinite(v)) out[k] = Math.min(MAX[k], Math.max(MIN[k], v));
  }
  return out;
}

interface Saved {
  showOnMap: boolean;
  warnings: boolean;
  thresholds: TrafficThresholds;
}

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && typeof s === 'object') {
      return {
        showOnMap: s.showOnMap !== false,
        warnings: s.warnings !== false,
        thresholds: clampThresholds(s.thresholds ?? {}),
      };
    }
  } catch {
    // Unreadable: defaults.
  }
  return { showOnMap: true, warnings: true, thresholds: { ...DEFAULT_THRESHOLDS } };
}

function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: the settings last this session.
  }
}

interface AdsbSettingsState extends Saved {
  setShowOnMap: (on: boolean) => void;
  setWarnings: (on: boolean) => void;
  setThresholds: (patch: Partial<TrafficThresholds>) => void;
  resetThresholds: () => void;
}

export const useAdsbSettingsStore = create<AdsbSettingsState>((set, get) => {
  const persist = () => {
    const { showOnMap, warnings, thresholds } = get();
    save({ showOnMap, warnings, thresholds });
  };
  return {
    ...load(),
    setShowOnMap: (showOnMap) => {
      set({ showOnMap });
      persist();
    },
    setWarnings: (warnings) => {
      set({ warnings });
      persist();
    },
    setThresholds: (patch) => {
      set({ thresholds: clampThresholds({ ...get().thresholds, ...patch }) });
      persist();
    },
    resetThresholds: () => {
      set({ thresholds: { ...DEFAULT_THRESHOLDS } });
      persist();
    },
  };
});
