// Terrain: elevation from AWS Terrain Tiles (Mapzen "terrarium" PNGs, open data: SRTM, and finer USGS 3DEP data in
// the US), and ArduPilot's terrain grid (AP_Terrain), so the app can answer the vehicle's TERRAIN_REQUESTs. Pure;
// fetching and caching is lib/terrainService.ts.
//
// AP_Terrain: the vehicle asks for a block of 7 x 8 sub-grids, each 4 x 4 points `grid_spacing` meters apart,
// starting at the block's south-west corner (TERRAIN_REQUEST: lat, lon, grid_spacing, and a 56-bit mask of the
// sub-grids it lacks). Each answer (TERRAIN_DATA) is one sub-grid: gridbit, and 16 heights in meters above sea level,
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
 * Inland basins below sea level: a box [south, west, north, east] in degrees, and the floor, the lowest real surface
 * in it (land or a lake's surface, in these tiles, with a few meters' margin). Inside one, a height below sea level is
 * kept down to the floor; anything lower is a lake bed (ETOPO1 fills some lakes at coarse zooms). None of the boxes
 * reaches the open sea. Coastal land a few meters below sea level (Dutch polders, the Fens, New Orleans, deltas) is
 * left out: there it reads 0, a few meters high, which the vehicle's own arming correction (TERRAIN_OFS_MAX) absorbs
 * near home.
 */
export const BELOW_SEA_BASINS: readonly {
  name: string;
  box: readonly [number, number, number, number];
  floor: number;
}[] = [
  { name: 'Dead Sea, Jordan valley and Sea of Galilee', box: [30.9, 35.2, 32.95, 35.8], floor: -445 },
  { name: 'Death Valley', box: [35.8, -117.4, 36.8, -116.5], floor: -90 },
  {
    name: 'Salton Trough, Imperial and Mexicali valleys, Laguna Salada',
    box: [32.0, -116.3, 33.8, -115.0],
    floor: -75,
  },
  { name: 'Qattara Depression and Siwa', box: [28.6, 25.0, 30.6, 29.6], floor: -135 },
  { name: 'Turpan Depression', box: [42.3, 88.5, 43.2, 90.0], floor: -160 },
  { name: 'Danakil Depression (Dallol, Lake Asale)', box: [13.9, 39.9, 14.4, 40.6], floor: -130 },
  { name: 'Lake Afrera', box: [13.1, 40.75, 13.4, 41.0], floor: -120 },
  { name: 'Lake Assal', box: [11.58, 42.32, 11.72, 42.48], floor: -170 },
  // The Caspian's surface is about -28 m; the deep lowland beside it is Karagiye, in its own box.
  { name: 'Caspian Sea and Caspian lowland', box: [36.5, 45.0, 48.5, 58.0], floor: -30 },
  { name: 'Karagiye Depression', box: [43.2, 51.45, 43.9, 52.15], floor: -135 },
  { name: 'Chott Melrhir and Chott el Gharsa', box: [33.5, 5.5, 34.7, 8.3], floor: -40 },
  { name: 'Lake Eyre', box: [-29.8, 136.6, -27.5, 138.5], floor: -20 },
  { name: 'Gran Bajo de San Julian (Laguna del Carbon)', box: [-49.8, -68.7, -49.4, -68.1], floor: -110 },
  { name: 'Lake Enriquillo', box: [18.35, -71.85, 18.6, -71.35], floor: -48 },
];

/** The lowest a height can be at (lat, lon): a basin's floor, the lowest of any that contain it, else 0 (sea level). */
export function terrainFloor(lat: number, lon: number): number {
  let floor = 0;
  for (const {
    box: [s, w, n, e],
    floor: f,
  } of BELOW_SEA_BASINS)
    if (lat >= s && lat <= n && lon >= w && lon <= e && f < floor) floor = f;
  return floor;
}

/** Whether (lat, lon) is in one of the inland basins below sea level. */
export const inBelowSeaBasin = (lat: number, lon: number) => terrainFloor(lat, lon) < 0;

/**
 * A height as land: never below sea level, except inside a known basin, down to its floor. The tiles fill the sea
 * with ETOPO1 sea-floor depths, which the vehicle would take as terrain (following terrain at 50 m over 30 m of water:
 * 20 m above the waves), and the clearance checks with it. Mission Planner, MAVProxy and QGroundControl send 0 over
 * the sea (SRTM and Copernicus have no bathymetry) and real heights on land below sea level; this does the same.
 */
export const landHeight = (h: number, lat: number, lon: number) => (h >= 0 ? h : Math.max(h, terrainFloor(lat, lon)));

/**
 * Height (m) at a point, from decoded tiles fetched by `getTile` (null when a tile isn't available). Bilinear between
 * pixel centers; at a tile edge it reads the neighboring tile. Sea floor reads 0 (landHeight).
 */
export function sampleHeight(
  lat: number,
  lon: number,
  getTile: (tx: number, ty: number) => Float32Array | null,
  z = TERRAIN_ZOOM
): number | null {
  const { x, y } = tileCoords(lat, lon, z);
  // Pixel coordinates in the whole map, pixel centers at +0.5.
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
  return landHeight(a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy, lat, lon);
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

/** ArduPilot's Location::offset_latlng: lat/lon in 1e7 degrees, moved `north` and `east` meters. */
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

/** TERRAIN_DATA heights: whole meters in int16 range. */
export const toTerrainInt16 = (h: number) => Math.max(-32768, Math.min(32767, Math.round(h)));
