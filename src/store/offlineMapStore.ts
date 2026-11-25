// Offline maps state: your own tile source (saved in this browser), the stored areas (lib/offlineTiles.ts), and the
// area being kept while browsing, if any.

import { create } from 'zustand';

import {
  AreaKeeper,
  deleteArea,
  downloadArea,
  importMbtiles,
  listAreas,
  newAreaId,
  offlineAvailable,
  validTemplate,
  type OfflineArea,
} from '../lib/offlineTiles';

/** A download or import in progress: runs on with the panel closed (stopped only by its Stop button). */
export interface OfflineJob {
  kind: 'downloaded' | 'terrain' | 'import';
  label: string;
  done: number;
  total: number;
  failed: number;
  bytes: number;
}

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
  /** The stored areas have been read (until then an imported layer can't be told from a deleted one). */
  areasLoaded: boolean;
  refresh: () => Promise<void>;
  /** Areas being deleted (thousands of tiles take a moment). */
  deleting: string[];
  remove: (id: string) => Promise<void>;
  /** The area being kept while browsing: every tile the map loads is added to it. */
  keeping: OfflineArea | null;
  keeper: AreaKeeper | null;
  /** The layer being kept (its name in `source`): tiles of another layer aren't added. */
  keepingLayer: string | null;
  startKeeping: (name: string, source: string, layer: string) => void;
  stopKeeping: () => Promise<void>;
  job: OfflineJob | null;
  /** The last job's failure, and which section it belongs under. */
  jobError: { from: 'download' | 'import'; message: string } | null;
  jobAbort: AbortController | null;
  startDownload: (area: OfflineArea, urls: string[], label: string) => Promise<void>;
  startImport: (file: File) => Promise<OfflineArea | null>;
  cancelJob: () => void;
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
  areasLoaded: false,
  refresh: async () => {
    if (!offlineAvailable()) {
      set({ areasLoaded: true });
      return;
    }
    try {
      set({ areas: await listAreas(), areasLoaded: true });
    } catch {
      // IndexedDB unavailable (private window): nothing stored.
      set({ areasLoaded: true });
    }
  },
  deleting: [],
  remove: async (id) => {
    // The area being kept is still being written: not deleted from under it.
    if (get().keeping?.id === id) return;
    set((s) => ({ deleting: [...s.deleting, id] }));
    try {
      await deleteArea(id);
    } finally {
      set((s) => ({ deleting: s.deleting.filter((x) => x !== id) }));
      await get().refresh();
    }
  },
  keeping: null,
  keeper: null,
  keepingLayer: null,
  startKeeping: (name, source, layer) => {
    if (get().keeper || !offlineAvailable()) return;
    const area: OfflineArea = {
      id: newAreaId(),
      name: name.trim() || 'Kept area',
      kind: 'kept',
      source,
      tiles: 0,
      bytes: 0,
      created: Date.now(),
    };
    const keeper = new AreaKeeper(area, (a) => set({ keeping: a }));
    set({ keeper, keeping: area, keepingLayer: layer });
  },
  job: null,
  jobError: null,
  jobAbort: null,
  startDownload: async (area, urls, label) => {
    if (get().job) return;
    const ac = new AbortController();
    set({
      job: {
        kind: area.kind === 'terrain' ? 'terrain' : 'downloaded',
        label,
        done: 0,
        total: urls.length,
        failed: 0,
        bytes: 0,
      },
      jobAbort: ac,
      jobError: null,
    });
    try {
      const result = await downloadArea(area, urls, {
        signal: ac.signal,
        onProgress: (done, failed, bytes) => set((s) => (s.job ? { job: { ...s.job, done, failed, bytes } } : {})),
      });
      if (result.tiles === 0) {
        set({
          jobError: {
            from: 'download',
            message:
              'Nothing could be downloaded. Check the source address and the connection; a tile server must allow other sites (CORS: Access-Control-Allow-Origin).',
          },
        });
      }
    } catch (e: unknown) {
      set({ jobError: { from: 'download', message: e instanceof Error ? e.message : 'The download failed.' } });
    } finally {
      set({ job: null, jobAbort: null });
      await get().refresh();
    }
  },
  startImport: async (file) => {
    if (get().job) return null;
    set({ job: { kind: 'import', label: file.name, done: 0, total: 0, failed: 0, bytes: 0 }, jobError: null });
    try {
      const area = await importMbtiles(file, (done, total) =>
        set((s) => (s.job ? { job: { ...s.job, done, total } } : {}))
      );
      return area;
    } catch (e: unknown) {
      set({ jobError: { from: 'import', message: e instanceof Error ? e.message : 'The file could not be read.' } });
      return null;
    } finally {
      set({ job: null });
      await get().refresh();
    }
  },
  cancelJob: () => get().jobAbort?.abort(),
  stopKeeping: async () => {
    const keeper = get().keeper;
    if (!keeper) return;
    set({ keeper: null, keeping: null, keepingLayer: null });
    const area = await keeper.stop();
    // An area nothing was kept in isn't listed.
    if (area.tiles === 0) await deleteArea(area.id);
    await get().refresh();
  },
}));
