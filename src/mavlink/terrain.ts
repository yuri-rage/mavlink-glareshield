// Terrain: elevation from AWS Terrain Tiles (Mapzen "terrarium" PNGs, open data: SRTM, and finer USGS 3DEP data in
// the US), and ArduPilot's terrain grid (AP_Terrain), so the app can answer the vehicle's TERRAIN_REQUESTs. Pure;
// fetching and caching is lib/terrainService.ts.
//
// AP_Terrain: the vehicle asks for a block of 7 x 8 sub-grids, each 4 x 4 points `grid_spacing` metres apart,
// starting at the block's south-west corner (TERRAIN_REQUEST: lat, lon, grid_spacing, and a 56-bit mask of the
// sub-grids it lacks). Each answer (TERRAIN_DATA) is one sub-grid: gridbit, and 16 heights in metres above sea level,
// x north, y east. Points are placed with ArduPilot's Location::offset, so they match the vehicle's own.

/** Zoom of the elevation tiles: about 38 m per pixel at the equator (31 m at 35 deg), the source data's own scale. */
export const TERRAIN_ZOOM = 12;
export const TILE_SIZE = 256;
export const terrariumUrl = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const TERRAIN_ATTRIBUTION = 'Terrain: AWS Terrain Tiles (Mapzen; SRTM, USGS 3DEP, others)';

/** Fractional tile coordinates (web mercator) of a point at zoom z. */
export function tileCoords(lat: number, lon: number, z = TERRAIN_ZOOM): { x: number; y: number } {
  const n = 2 ** z;
  const latR = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n,
  };
}

/** Heights (m) from a terrarium tile's RGBA pixels: (R * 256 + G + B / 256) - 32768. */
export function decodeTerrarium(rgba: Uint8ClampedArray | Uint8Array, size = TILE_SIZE): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) out[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
  return out;
}

/** An elevation tile at TERRAIN_ZOOM. */
export interface TileKey {
  x: number;
  y: number;
}

/**
 * Height (m) at a point, from decoded tiles fetched by `getTile` (null when a tile isn't available). Bilinear between
 * pixel centres; at a tile edge it reads the neighbouring tile.
 */
export function sampleHeight(
  lat: number,
  lon: number,
  getTile: (tx: number, ty: number) => Float32Array | null,
  z = TERRAIN_ZOOM
): number | null {
  const { x, y } = tileCoords(lat, lon, z);
  // Pixel coordinates in the whole map, pixel centres at +0.5.
  const px = x * TILE_SIZE - 0.5;
  const py = y * TILE_SIZE - 0.5;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const world = 2 ** z * TILE_SIZE;
  const at = (gx: number, gy: number): number | null => {
    // Across the antimeridian the map wraps; at the poles of web mercator it stops.
    const wx = ((gx % world) + world) % world;
    const wy = Math.min(world - 1, Math.max(0, gy));
    const tx = Math.floor(wx / TILE_SIZE);
    const ty = Math.floor(wy / TILE_SIZE);
    const t = getTile(tx, ty);
    if (!t) return null;
    return t[(wy - ty * TILE_SIZE) * TILE_SIZE + (wx - tx * TILE_SIZE)];
  };
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  if (a === null || b === null || c === null || d === null) return null;
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/** The tiles `sampleHeight` reads for a point (so they can be fetched first). */
export function tilesFor(lat: number, lon: number, z = TERRAIN_ZOOM): TileKey[] {
  const { x, y } = tileCoords(lat, lon, z);
  const px = x * TILE_SIZE - 0.5;
  const py = y * TILE_SIZE - 0.5;
  const keys = new Map<string, TileKey>();
  const world = 2 ** z * TILE_SIZE;
  for (const gx of [Math.floor(px), Math.floor(px) + 1]) {
    for (const gy of [Math.floor(py), Math.floor(py) + 1]) {
      const wx = ((gx % world) + world) % world;
      const wy = Math.min(world - 1, Math.max(0, gy));
      const k = { x: Math.floor(wx / TILE_SIZE), y: Math.floor(wy / TILE_SIZE) };
      keys.set(`${k.x}/${k.y}`, k);
    }
  }
  return [...keys.values()];
}

// ------------------------------------------------------------------------------------------------
// ArduPilot's terrain grid
// ------------------------------------------------------------------------------------------------

export const TERRAIN_GRID_MAVLINK_SIZE = 4;
export const TERRAIN_GRID_BLOCK_MUL_X = 7;
export const TERRAIN_GRID_BLOCK_MUL_Y = 8;
const LATLON_TO_M_INV = 89.83204953368922;

/** ArduPilot's Location::offset_latlng: lat/lon in 1e7 degrees, moved `north` and `east` metres. */
export function apOffset(lat: number, lon: number, north: number, east: number): { lat: number; lon: number } {
  const dlat = Math.trunc(north * LATLON_TO_M_INV);
  const scale = Math.max(Math.cos((lat + dlat / 2) * 1e-7 * (Math.PI / 180)), 0.01);
  const dlng = Math.trunc((east * LATLON_TO_M_INV) / scale);
  return { lat: lat + dlat, lon: lon + dlng };
}

/** The 16 points of one sub-grid (gridbit) of a block, in TERRAIN_DATA order (x north outer, y east inner). */
export function subgridPoints(
  blockLat: number,
  blockLon: number,
  spacing: number,
  gridbit: number
): { lat: number; lon: number }[] {
  const idxX = Math.floor(gridbit / TERRAIN_GRID_BLOCK_MUL_Y) * TERRAIN_GRID_MAVLINK_SIZE;
  const idxY = (gridbit % TERRAIN_GRID_BLOCK_MUL_Y) * TERRAIN_GRID_MAVLINK_SIZE;
  const out: { lat: number; lon: number }[] = [];
  for (let x = 0; x < TERRAIN_GRID_MAVLINK_SIZE; x++) {
    for (let y = 0; y < TERRAIN_GRID_MAVLINK_SIZE; y++) {
      const p = apOffset(blockLat, blockLon, (idxX + x) * spacing, (idxY + y) * spacing);
      out.push({ lat: p.lat * 1e-7, lon: p.lon * 1e-7 });
    }
  }
  return out;
}

/** The sub-grids a TERRAIN_REQUEST asks for (set bits of its 56-bit mask). */
export function requestedGridbits(mask: bigint): number[] {
  const out: number[] = [];
  for (let b = 0; b < TERRAIN_GRID_BLOCK_MUL_X * TERRAIN_GRID_BLOCK_MUL_Y; b++)
    if ((mask >> BigInt(b)) & 1n) out.push(b);
  return out;
}

/** TERRAIN_DATA heights: whole metres in int16 range. */
export const toTerrainInt16 = (h: number) => Math.max(-32768, Math.min(32767, Math.round(h)));
