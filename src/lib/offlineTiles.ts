// Offline map tiles: areas kept for use without internet, in the browser's Cache API (cache OFFLINE_CACHE, never
// evicted by the app), with an index of named areas in IndexedDB. Three ways in:
// - kept: while "keeping" an area, every tile the map loads is copied in (the public imagery and street tiles may
//   not be bulk-downloaded under their providers' terms, but what you view can be kept);
// - downloaded: an area and zoom range fetched from your own tile source (a server you run or are licensed for), or
//   the open terrain tiles;
// - imported: an MBTiles file (made in QGIS or elsewhere from a source you may use offline), its tiles stored under
//   IMPORT_HOST addresses and shown as a map layer of its own.
// The map's tile layer looks in this cache first (offlineTileUrl), so kept and imported tiles show with no
// network. Needs a secure page (https or localhost): elsewhere the Cache API doesn't exist, and offlineAvailable()
// says so.

import { CACHE_NAME as TERRAIN_SERVICE_CACHE } from './terrainService';

export const OFFLINE_CACHE = 'glareshield-offline-v1';
/** Addresses for imported tiles: never fetched, only cache keys. */
export const IMPORT_HOST = 'https://offline.glareshield.invalid';
/** A typical imagery tile, for size estimates before a download. */
export const AVG_TILE_BYTES = 20_000;
/** At most this many tiles in one download (a few hundred MB). */
export const MAX_DOWNLOAD_TILES = 20_000;

export interface LatLngBoundsLike {
  south: number;
  west: number;
  north: number;
  east: number;
}

export type OfflineKind = 'kept' | 'downloaded' | 'imported' | 'terrain';

export interface OfflineArea {
  id: string;
  name: string;
  kind: OfflineKind;
  /** The layer or source the tiles came from ("Satellite", your source's name, the file's name). */
  source: string;
  bounds?: LatLngBoundsLike;
  minZoom?: number;
  maxZoom?: number;
  tiles: number;
  bytes: number;
  created: number;
  /** Imported sets: the tile format and attribution, for the layer. */
  format?: string;
  attribution?: string;
}

// ------------------------------------------------------------------------------------------------
// Tile maths (pure)
// ------------------------------------------------------------------------------------------------

/** The tile column and row containing a point at zoom z (Web Mercator, as Leaflet). */
export function tileXY(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/** The tiles covering `b` at zoom z: column and row ranges, inclusive (one range, unless it crosses ±180°). */
export function tileRange(b: LatLngBoundsLike, z: number): { x0: number; x1: number; y0: number; y1: number } {
  return tileRanges(b, z)[0];
}

/**
 * The tiles covering `b` at zoom z, as column/row ranges. A map panned across the antimeridian reports longitudes
 * beyond ±180 (or west east of east): those wrap, giving two ranges, one each side; a view wider than the world is
 * every column.
 */
export function tileRanges(b: LatLngBoundsLike, z: number): { x0: number; x1: number; y0: number; y1: number }[] {
  const n = 2 ** z;
  const y0 = tileXY(b.north, 0, z).y;
  const y1 = tileXY(b.south, 0, z).y;
  if (b.east - b.west >= 360) return [{ x0: 0, x1: n - 1, y0, y1 }];
  const wrap = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
  const x0 = tileXY(0, wrap(b.west), z).x;
  // An east edge exactly on 180° is the world's last column, not wrapped round to -180 (column 0).
  const eastWrapped = wrap(b.east);
  const x1 = tileXY(0, eastWrapped === -180 && b.east > b.west ? 180 : eastWrapped, z).x;
  return x0 <= x1
    ? [{ x0, x1, y0, y1 }]
    : [
        { x0, x1: n - 1, y0, y1 },
        { x0: 0, x1, y0, y1 },
      ];
}

/** How many tiles cover `b` from zoom zMin to zMax. */
export function countTiles(b: LatLngBoundsLike, zMin: number, zMax: number): number {
  let n = 0;
  for (let z = zMin; z <= zMax; z++) for (const r of tileRanges(b, z)) n += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  return n;
}

/** Every tile covering `b` from zMin to zMax, lowest zoom first. */
export function* tilesIn(
  b: LatLngBoundsLike,
  zMin: number,
  zMax: number
): Generator<{ z: number; x: number; y: number }> {
  for (let z = zMin; z <= zMax; z++) {
    for (const r of tileRanges(b, z))
      for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) yield { z, x, y };
  }
}

/** The subdomains a template's {s} uses: the source's, or Leaflet's default when left empty. */
export const effectiveSubdomains = (s: string | undefined) => (s && s.trim() ? s.trim() : 'abc');

/**
 * A tile's URL from a template, as Leaflet builds it (TileLayer.getTileUrl): {z} {x} {y}, {-y} (TMS rows), {s} the
 * subdomain Leaflet picks for that tile (|x + y| mod the count), {r} '@2x' on a high-density screen (Leaflet's
 * Browser.retina, whatever the layer's options) else ''. The same URL the map requests, so a kept or downloaded tile
 * is found again; pass `retina` as the map's browser has it.
 */
export function tileUrl(template: string, z: number, x: number, y: number, subdomains = 'abc', retina = false): string {
  const subs = effectiveSubdomains(subdomains);
  // Every occurrence of each placeholder (split/join: replaceAll is ES2021).
  const values: [string, string][] = [
    ['{s}', subs[Math.abs(x + y) % subs.length]],
    ['{z}', String(z)],
    ['{x}', String(x)],
    ['{-y}', String(2 ** z - 1 - y)],
    ['{y}', String(y)],
    ['{r}', retina ? '@2x' : ''],
  ];
  return values.reduce((url, [k, v]) => url.split(k).join(v), template);
}

/** MBTiles stores rows bottom-up (TMS): the XYZ row of a tile. */
export const mbtilesRowToY = (z: number, row: number) => 2 ** z - 1 - row;

/** An imported set's tile address (a cache key). */
export const importTileUrl = (setId: string, z: number, x: number, y: number) =>
  `${IMPORT_HOST}/${setId}/${z}/${x}/${y}`;

/** A template is usable when it has {z}, {x} and {y} (or {-y}) and is http(s). */
export function validTemplate(t: string): boolean {
  return /^https?:\/\//.test(t) && t.includes('{z}') && t.includes('{x}') && (t.includes('{y}') || t.includes('{-y}'));
}

// ------------------------------------------------------------------------------------------------
// Storage (browser)
// ------------------------------------------------------------------------------------------------

/** Offline tiles work here: a secure page with the Cache API and IndexedDB. */
export function offlineAvailable(): boolean {
  return (
    typeof caches !== 'undefined' &&
    typeof indexedDB !== 'undefined' &&
    (typeof window === 'undefined' || window.isSecureContext !== false)
  );
}

/** Terrain areas go in the terrain service's own cache, where it looks for them. */
export const TERRAIN_CACHE = TERRAIN_SERVICE_CACHE;

let cachePromise: Promise<Cache> | null = null;
const offlineCache = () => (cachePromise ??= caches.open(OFFLINE_CACHE));
const cacheFor = (kind: OfflineKind) => (kind === 'terrain' ? caches.open(TERRAIN_CACHE) : offlineCache());

/** An object URL for a kept, downloaded or imported tile, or null when it isn't stored (load it normally). */
export async function offlineTileUrl(url: string): Promise<string | null> {
  if (!offlineAvailable()) return null;
  try {
    const hit = await (await offlineCache()).match(url);
    return hit ? URL.createObjectURL(await hit.blob()) : null;
  } catch {
    return null;
  }
}

const DB_NAME = 'glareshield-offline';
const AREAS = 'areas';
const AREA_TILES = 'areaTiles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(AREAS, { keyPath: 'id' });
      req.result.createObjectStore(AREA_TILES);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => IDBRequest<T> | void
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const r = fn(t);
    t.oncomplete = () => {
      db.close();
      resolve(r ? (r.result as T) : undefined);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

export async function listAreas(): Promise<OfflineArea[]> {
  const all = (await tx<OfflineArea[]>([AREAS], 'readonly', (t) => t.objectStore(AREAS).getAll())) ?? [];
  return all.sort((a, b) => b.created - a.created);
}

async function saveArea(area: OfflineArea, urls?: string[]): Promise<void> {
  await tx([AREAS, AREA_TILES], 'readwrite', (t) => {
    t.objectStore(AREAS).put(area);
    if (urls) t.objectStore(AREA_TILES).put(urls, area.id);
  });
}

async function areaUrls(id: string): Promise<string[]> {
  return (await tx<string[]>([AREA_TILES], 'readonly', (t) => t.objectStore(AREA_TILES).get(id))) ?? [];
}

/** Delete an area and the tiles no other area keeps. */
export async function deleteArea(id: string): Promise<void> {
  const areas = await listAreas();
  const area = areas.find((a) => a.id === id);
  const mine = await areaUrls(id);
  const others = new Set<string>();
  // Only areas in the same cache can share its tiles (terrain has its own).
  const sameCache = (k: OfflineKind) => (k === 'terrain') === (area?.kind === 'terrain');
  for (const a of areas) if (a.id !== id && sameCache(a.kind)) for (const u of await areaUrls(a.id)) others.add(u);
  const cache = await cacheFor(area?.kind ?? 'kept');
  const gone = mine.filter((u) => !others.has(u));
  // In batches: thousands of deletes one after another took many seconds.
  for (let i = 0; i < gone.length; i += 64) await Promise.all(gone.slice(i, i + 64).map((u) => cache.delete(u)));
  await tx([AREAS, AREA_TILES], 'readwrite', (t) => {
    t.objectStore(AREAS).delete(id);
    t.objectStore(AREA_TILES).delete(id);
  });
}

export const newAreaId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Store one tile (fetched now) in the offline cache; its size in bytes, or null when it couldn't be fetched. */
async function storeTile(url: string, signal?: AbortSignal, kind: OfflineKind = 'kept'): Promise<number | null> {
  const cache = await cacheFor(kind);
  const have = await cache.match(url);
  if (have) return (await have.clone().blob()).size;
  const res = await fetch(url, { mode: 'cors', signal });
  if (!res.ok || res.type === 'opaque') return null;
  const blob = await res.clone().blob();
  await cache.put(url, res);
  return blob.size;
}

/**
 * Keeping an area: tiles the map loads are added to it (keepTile), and written to the index every couple of
 * seconds and when it stops.
 */
export class AreaKeeper {
  private urls = new Set<string>();
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    public area: OfflineArea,
    private onChange?: (area: OfflineArea) => void
  ) {}

  async keepTile(url: string): Promise<void> {
    if (this.urls.has(url)) return;
    this.urls.add(url);
    try {
      const size = await storeTile(url);
      if (size === null) {
        this.urls.delete(url);
        return;
      }
      this.bytes += size;
      this.area = { ...this.area, tiles: this.urls.size, bytes: this.bytes };
      this.onChange?.(this.area);
      this.timer ??= setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, 2000);
    } catch {
      this.urls.delete(url);
    }
  }

  async flush(): Promise<void> {
    await saveArea(this.area, [...this.urls]);
  }

  async stop(): Promise<OfflineArea> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
    return this.area;
  }
}

/**
 * Download `urls` into an area, a few at a time; progress after each tile. Stops (keeping what arrived) when
 * `signal` aborts. Tiles that fail are skipped and counted.
 */
export async function downloadArea(
  area: OfflineArea,
  urls: string[],
  opts: {
    signal?: AbortSignal;
    concurrency?: number;
    onProgress?: (done: number, failed: number, bytes: number) => void;
  } = {}
): Promise<OfflineArea> {
  const kept: string[] = [];
  let next = 0;
  let done = 0;
  let failed = 0;
  let bytes = 0;
  const worker = async () => {
    while (next < urls.length && !opts.signal?.aborted) {
      const url = urls[next++];
      try {
        const size = await storeTile(url, opts.signal, area.kind);
        if (size === null) failed++;
        else {
          kept.push(url);
          bytes += size;
        }
      } catch {
        if (opts.signal?.aborted) break;
        failed++;
      }
      done++;
      opts.onProgress?.(done, failed, bytes);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker));
  const result = { ...area, tiles: kept.length, bytes };
  // Nothing arrived: no empty area listed.
  if (kept.length > 0) await saveArea(result, kept);
  return result;
}

/** The browser's storage use and quota, and whether it's persistent (not cleared under pressure). */
export async function storageInfo(): Promise<{ usage?: number; quota?: number; persisted?: boolean }> {
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    return { usage: est?.usage, quota: est?.quota, persisted };
  } catch {
    return {};
  }
}

/** Ask the browser to keep this site's storage (offline tiles) even when space runs low. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------------------------
// MBTiles import
// ------------------------------------------------------------------------------------------------

/** Load the MBTiles reader (sql.js and its WebAssembly) ahead of need, so it's cached for an import made offline. */
export async function preloadMbtilesReader(): Promise<void> {
  try {
    await import('sql.js');
    const wasmUrl = (await import('sql.js/dist/sql-wasm.wasm?url')).default;
    await fetch(wasmUrl);
  } catch {
    // Offline or blocked: loaded when an import needs it.
  }
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/**
 * Import an MBTiles file (SQLite: metadata and tiles tables, TMS rows) as an area with its own layer. Raster
 * formats only (png, jpg, webp); vector tiles (pbf) are refused. Progress as tiles are stored.
 */
export async function importMbtiles(
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<OfflineArea> {
  const initSqlJs = (await import('sql.js')).default;
  const wasmUrl = (await import('sql.js/dist/sql-wasm.wasm?url')).default;
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  try {
    const meta: Record<string, string> = {};
    for (const row of db.exec('SELECT name, value FROM metadata')[0]?.values ?? [])
      meta[String(row[0])] = String(row[1]);
    const format = (meta.format ?? 'png').toLowerCase();
    if (!MIME[format]) throw new Error(`${format} tiles aren't supported (raster png, jpg or webp only)`);
    const total = Number(db.exec('SELECT COUNT(*) FROM tiles')[0]?.values[0]?.[0] ?? 0);
    if (!total) throw new Error('The file has no tiles');
    const id = newAreaId();
    const cache = await offlineCache();
    const urls: string[] = [];
    let bytes = 0;
    let minZoom = Infinity;
    let maxZoom = -Infinity;
    const stmt = db.prepare('SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles');
    try {
      while (stmt.step()) {
        const [z, col, row, data] = stmt.get() as [number, number, number, Uint8Array | null];
        if (!(data instanceof Uint8Array) || data.byteLength === 0) continue; // a corrupt row: skipped
        const url = importTileUrl(id, z, col, mbtilesRowToY(z, row));
        await cache.put(
          url,
          new Response(new Blob([data as Uint8Array<ArrayBuffer>], { type: MIME[format] }), {
            headers: { 'Content-Type': MIME[format] },
          })
        );
        urls.push(url);
        bytes += data.byteLength;
        minZoom = Math.min(minZoom, z);
        maxZoom = Math.max(maxZoom, z);
        if (urls.length % 50 === 0) onProgress?.(urls.length, total);
      }
    } catch (e) {
      // Failed part way (out of space, a bad file): take back what was written, then say why.
      for (let i = 0; i < urls.length; i += 64) await Promise.all(urls.slice(i, i + 64).map((u) => cache.delete(u)));
      throw e;
    } finally {
      stmt.free();
    }
    if (urls.length === 0) throw new Error('No readable tiles in the file');
    onProgress?.(urls.length, total);
    const b = (meta.bounds ?? '').split(',').map(Number);
    const area: OfflineArea = {
      id,
      name: meta.name || file.name.replace(/\.mbtiles$/i, ''),
      kind: 'imported',
      source: file.name,
      bounds:
        b.length === 4 && b.every(Number.isFinite) ? { west: b[0], south: b[1], east: b[2], north: b[3] } : undefined,
      minZoom,
      maxZoom,
      tiles: urls.length,
      bytes,
      created: Date.now(),
      format,
      attribution: meta.attribution,
    };
    try {
      await saveArea(area, urls);
    } catch (e) {
      // The index couldn't be written: the tiles would be stored with nothing to list (or delete) them by.
      for (let i = 0; i < urls.length; i += 64) await Promise.all(urls.slice(i, i + 64).map((u) => cache.delete(u)));
      throw e;
    }
    return area;
  } finally {
    db.close();
  }
}
