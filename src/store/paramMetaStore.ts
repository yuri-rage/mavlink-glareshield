// Loads the parameter metadata that matches the connected vehicle and firmware (see mavlink/paramCatalog.ts),
// caches it in the browser so it also works offline in the field, and tells the editor which metadata is in use.

import { create } from 'zustand';
import type { VehicleCategory } from '../mavlink/messages';
import { setActiveParamCatalog, type ParamMeta } from '../mavlink/paramMetadata';
import {
  catalogCandidates,
  describeCatalogMatch,
  parseFirmwareVersion,
  parsePdefJson,
  repoVehicleName,
  type CatalogCandidate,
} from '../mavlink/paramCatalog';

/** Cache Storage name; the service worker keeps it across deploys. */
export const PARAM_META_CACHE = 'glareshield-param-meta-v1';
const FETCHED_AT_HEADER = 'x-glareshield-fetched-at';
/** Refresh a cached copy in the background after this long (dev metadata changes daily). */
const MAX_AGE_MS = { dev: 24 * 3600_000, release: 30 * 24 * 3600_000 };
const DOWNLOAD_TIMEOUT_MS = 15_000;

export type ParamMetaStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

interface ParamMetaState {
  status: ParamMetaStatus;
  /** What was asked for, e.g. "Rover@4.6.2"; a new request replaces an older one. */
  requestKey: string | null;
  catalog: Record<string, ParamMeta> | null;
  /** The folder in use and how well it matches. */
  source: (CatalogCandidate & { fromCache: boolean }) | null;
  /** One sentence for the editor: which metadata, and how closely it matches. */
  summary: string;
  ensure: (category: VehicleCategory, firmwareVersion: string | null) => void;
}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches !== 'undefined' ? await caches.open(PARAM_META_CACHE) : null;
  } catch {
    return null;
  }
}

/** Downloads and parses one folder's metadata; null when it doesn't exist (404). Throws on network errors. */
async function download(c: CatalogCandidate): Promise<Record<string, ParamMeta> | null> {
  // A slow field link must not leave the editor waiting indefinitely.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    return await downloadWith(c, ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function downloadWith(c: CatalogCandidate, signal: AbortSignal): Promise<Record<string, ParamMeta> | null> {
  const res = await fetch(c.url, { cache: 'no-cache', signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const catalog = parsePdefJson(await res.json());
  return Object.keys(catalog).length ? catalog : null;
}

async function store(cache: Cache | null, c: CatalogCandidate, catalog: Record<string, ParamMeta>) {
  if (!cache) return;
  try {
    // The parsed, trimmed catalogue is stored, not the raw file: smaller, and no parsing on the next load.
    await cache.put(
      c.url,
      new Response(JSON.stringify(catalog), {
        headers: { 'content-type': 'application/json', [FETCHED_AT_HEADER]: String(Date.now()) },
      })
    );
  } catch {
    // Quota or private mode: works without the cache.
  }
}

export const useParamMetaStore = create<ParamMetaState>((set, get) => ({
  status: 'idle',
  requestKey: null,
  catalog: null,
  source: null,
  summary: '',

  ensure: (category, firmwareVersion) => {
    const vehicle = repoVehicleName(category);
    const version = parseFirmwareVersion(firmwareVersion);
    if (!vehicle || !version) {
      // Without both there is nothing version-specific to load; don't guess.
      if (get().requestKey !== null) {
        setActiveParamCatalog(null);
        set({ status: 'idle', requestKey: null, catalog: null, source: null, summary: '' });
      }
      return;
    }
    const key = `${vehicle}@${version.major}.${version.minor}.${version.patch}-${version.type}`;
    if (get().requestKey === key) return;
    set({ status: 'loading', requestKey: key, summary: `Loading ${vehicle} ${version.major}.${version.minor} parameter metadata…` });

    void (async () => {
      const cache = await openCache();
      const candidates = catalogCandidates(vehicle, version);
      let networkFailed = false;
      for (const c of candidates) {
        if (get().requestKey !== key) return; // superseded (another vehicle or version connected)
        let catalog: Record<string, ParamMeta> | null = null;
        let fromCache = false;
        let fetchedAt = 0;
        try {
          const hit = await cache?.match(c.url);
          if (hit) {
            catalog = await hit.json();
            fromCache = true;
            fetchedAt = Number(hit.headers.get(FETCHED_AT_HEADER)) || 0;
          }
        } catch {
          catalog = null;
        }
        if (!catalog && !networkFailed) {
          try {
            catalog = await download(c);
            if (catalog) await store(cache, c, catalog);
          } catch {
            // Offline or the host is unreachable: stop trying the network, but still check the cache for an
            // earlier version.
            networkFailed = true;
            catalog = null;
          }
        }
        if (!catalog) continue;
        if (get().requestKey !== key) return;

        setActiveParamCatalog(catalog);
        set({
          status: 'ready',
          catalog,
          source: { ...c, fromCache },
          summary: describeCatalogMatch(vehicle, version, c) + (fromCache ? ' (cached)' : ''),
        });

        // Refresh a stale cached copy in the background; the new copy is used from the next load.
        const maxAge = c.match === 'dev-same-minor' ? MAX_AGE_MS.dev : MAX_AGE_MS.release;
        if (fromCache && Date.now() - fetchedAt > maxAge) {
          void download(c)
            .then((fresh) => fresh && store(cache, c, fresh))
            .catch(() => {});
        }
        return;
      }
      if (get().requestKey !== key) return;
      setActiveParamCatalog(null);
      set({
        status: 'unavailable',
        catalog: null,
        source: null,
        summary: `No ${vehicle} parameter metadata could be loaded (offline, or not published for ${version.major}.${version.minor}); showing built-in descriptions for common parameters only.`,
      });
    })();
  },
}));
