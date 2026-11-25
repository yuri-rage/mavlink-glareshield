// Elevation for the app (mavlink/terrain.ts): fetches AWS Terrain Tiles, keeps the decoded ones in memory (LRU) and
// the PNGs in the browser's Cache API (so they survive reloads and work offline once fetched), and answers height
// queries. Fetching and decoding are injectable so tests can run without a browser.

import { TERRAIN_ZOOM, decodeTerrarium, sampleHeight, terrariumUrl, tilesFor } from '../mavlink/terrain';

/** Fetches a tile's PNG bytes (null when it can't), and decodes PNG bytes into RGBA pixels. */
export interface TerrainIO {
  fetchPng: (url: string) => Promise<Blob | null>;
  decodePng: (png: Blob) => Promise<Uint8ClampedArray>;
}

/** Terrain PNGs kept by the browser (offline maps download into it too). */
export const CACHE_NAME = 'glareshield-terrain-v1';
/** Decoded tiles kept in memory (256 x 256 floats, 256 KB each). */
const MEMORY_TILES = 96;
/** A tile that failed isn't asked for again for this long. */
const RETRY_MS = 60_000;

/** The browser's way: Cache API first, then the network (caching what arrives); decode with a canvas. */
export const browserTerrainIO: TerrainIO = {
  fetchPng: async (url) => {
    try {
      const cache = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : null;
      const hit = await cache?.match(url);
      if (hit) return await hit.blob();
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) return null;
      await cache?.put(url, res.clone()).catch(() => {});
      return await res.blob();
    } catch {
      return null;
    }
  },
  decodePng: async (png) => {
    const bmp = await createImageBitmap(png, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } as ImageBitmapOptions);
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  },
};

export class TerrainService {
  private tiles = new Map<string, Float32Array>();
  private inflight = new Map<string, Promise<Float32Array | null>>();
  private failedAt = new Map<string, number>();
  public enabled = true;

  constructor(private io: TerrainIO, private zoom = TERRAIN_ZOOM) {}

  private key = (x: number, y: number) => `${this.zoom}/${x}/${y}`;

  /** A decoded tile already in memory (marked most recently used), or null. */
  private cached(x: number, y: number): Float32Array | null {
    const k = this.key(x, y);
    const t = this.tiles.get(k);
    if (!t) return null;
    this.tiles.delete(k);
    this.tiles.set(k, t);
    return t;
  }

  /** Fetch and decode a tile (once at a time), keeping it in memory. */
  private load(x: number, y: number): Promise<Float32Array | null> {
    const k = this.key(x, y);
    const have = this.cached(x, y);
    if (have) return Promise.resolve(have);
    const failed = this.failedAt.get(k);
    if (failed !== undefined && Date.now() - failed < RETRY_MS) return Promise.resolve(null);
    let p = this.inflight.get(k);
    if (!p) {
      p = (async () => {
        try {
          const png = await this.io.fetchPng(terrariumUrl(this.zoom, x, y));
          if (!png) throw new Error('no tile');
          const heights = decodeTerrarium(await this.io.decodePng(png));
          this.tiles.set(k, heights);
          while (this.tiles.size > MEMORY_TILES) this.tiles.delete(this.tiles.keys().next().value!);
          this.failedAt.delete(k);
          return heights;
        } catch {
          this.failedAt.set(k, Date.now());
          return null;
        } finally {
          this.inflight.delete(k);
        }
      })();
      this.inflight.set(k, p);
    }
    return p;
  }

  /** Heights (m above sea level) at points, fetching the tiles they need; null where unavailable or turned off. */
  async heightsAt(points: { lat: number; lon: number }[]): Promise<(number | null)[]> {
    if (!this.enabled) return points.map(() => null);
    const need = new Map<string, { x: number; y: number }>();
    for (const p of points) for (const t of tilesFor(p.lat, p.lon, this.zoom)) need.set(`${t.x}/${t.y}`, t);
    await Promise.all([...need.values()].map((t) => this.load(t.x, t.y)));
    return points.map((p) => sampleHeight(p.lat, p.lon, (tx, ty) => this.cached(tx, ty), this.zoom));
  }

  async heightAt(lat: number, lon: number): Promise<number | null> {
    return (await this.heightsAt([{ lat, lon }]))[0];
  }

  /** Height from tiles already in memory only (for drawing as the pointer moves); null if not loaded yet. */
  heightNow(lat: number, lon: number): number | null {
    return this.enabled ? sampleHeight(lat, lon, (tx, ty) => this.cached(tx, ty), this.zoom) : null;
  }
}
