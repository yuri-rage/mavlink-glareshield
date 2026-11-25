// Offline maps state: your own tile source (saved in this browser), the stored areas (lib/offlineTiles.ts), and the
// area being kept while browsing, if any.

import { create } from 'zustand';
import { AreaKeeper, deleteArea, listAreas, newAreaId, offlineAvailable, validTemplate, type OfflineArea } from '../lib/offlineTiles';

const KEY = 'mavlink_glareshield_tile_source';

/** A tile server you run or are licensed to download from: a map layer, and areas may be downloaded from it. */
export interface CustomTileSource {
  name: string;
  /** {z}/{x}/{y} template (also {s}, {-y}). */
  url: string;
  maxZoom: number;
  subdomains: string;
  attribution: string;
}

function loadSource(): CustomTileSource | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && typeof s.url === 'string' && validTemplate(s.url)) {
      return {
        name: String(s.name || 'My tiles'),
        url: s.url,
        maxZoom: Number.isFinite(s.maxZoom) ? Math.min(24, Math.max(1, s.maxZoom)) : 19,
        subdomains: typeof s.subdomains === 'string' ? s.subdomains : 'abc',
        attribution: String(s.attribution ?? ''),
      };
    }
  } catch {
    // Unreadable: none.
  }
  return null;
}

interface OfflineMapState {
  customSource: CustomTileSource | null;
  setCustomSource: (s: CustomTileSource | null) => void;
  areas: OfflineArea[];
  refresh: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** The area being kept while browsing: every tile the map loads is added to it. */
  keeping: OfflineArea | null;
  keeper: AreaKeeper | null;
  startKeeping: (name: string, source: string) => void;
  stopKeeping: () => Promise<void>;
}

export const useOfflineMapStore = create<OfflineMapState>((set, get) => ({
  customSource: loadSource(),
  setCustomSource: (s) => {
    try {
      if (s) localStorage.setItem(KEY, JSON.stringify(s));
      else localStorage.removeItem(KEY);
    } catch {
      // Storage unavailable: this session only.
    }
    set({ customSource: s });
  },
  areas: [],
  refresh: async () => {
    if (!offlineAvailable()) return;
    try {
      set({ areas: await listAreas() });
    } catch {
      // IndexedDB unavailable (private window): nothing stored.
    }
  },
  remove: async (id) => {
    await deleteArea(id);
    await get().refresh();
  },
  keeping: null,
  keeper: null,
  startKeeping: (name, source) => {
    if (get().keeper || !offlineAvailable()) return;
    const area: OfflineArea = { id: newAreaId(), name: name.trim() || 'Kept area', kind: 'kept', source, tiles: 0, bytes: 0, created: Date.now() };
    const keeper = new AreaKeeper(area, (a) => set({ keeping: a }));
    set({ keeper, keeping: area });
  },
  stopKeeping: async () => {
    const keeper = get().keeper;
    if (!keeper) return;
    set({ keeper: null, keeping: null });
    const area = await keeper.stop();
    // An area nothing was kept in isn't listed.
    if (area.tiles === 0) await deleteArea(area.id);
    await get().refresh();
  },
}));
