/**
 * Terrain checks: terrarium decoding and tile maths, bilinear sampling, ArduPilot's terrain grid (offsets, sub-grid
 * points, request masks), the elevation service (caching, failures) and the terrain server (what it sends to the
 * vehicle, no double answers, tiles it can't cover). The TERRAIN_DATA frame is read back with the app's parser.
 *
 * Run: npx tsx tests/terrain.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const t = await import('../src/mavlink/terrain.ts');
const { TerrainService } = await import('../src/lib/terrainService.ts');
const { TerrainServer } = await import('../src/mavlink/terrainServer.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');
const { MavlinkParser } = await import('../src/mavlink/parser.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

// Terrarium
{
  const rgba = new Uint8Array(4 * 4);
  // 1600 m -> 34368 = 134 * 256 + 64; -10.5 m -> 32757.5 = 127 * 256 + 245 + 128/256
  rgba.set([134, 64, 0, 255, 127, 245, 128, 255, 128, 0, 0, 255, 0, 0, 0, 255]);
  const h = t.decodeTerrarium(rgba, 2);
  check(
    'terrarium decode: (R*256 + G + B/256) - 32768',
    h[0] === 1600 && h[1] === -10.5 && h[2] === 0 && h[3] === -32768,
    Array.from(h).join(',')
  );
  const c = t.tileCoords(0, 0, 1);
  check('tile coords: 0,0 at zoom 1 is the centre', near(c.x, 1) && near(c.y, 1));
  const abq = t.tileCoords(35, -106, 12);
  check(
    'tile coords: 35,-106 at zoom 12',
    Math.floor(abq.x) === 841 && Math.floor(abq.y) === 1622,
    `${abq.x}, ${abq.y}`
  );
}

// Sampling: a synthetic world where height = pixel x (global) + 1000 * pixel y.
{
  const z = 12;
  const tile = (tx: number, ty: number) => {
    const a = new Float32Array(256 * 256);
    for (let py = 0; py < 256; py++)
      for (let px = 0; px < 256; px++) a[py * 256 + px] = tx * 256 + px + 1000 * (ty * 256 + py);
    return a;
  };
  const { x, y } = t.tileCoords(35, -106, z);
  const expect = x * 256 - 0.5 + 1000 * (y * 256 - 0.5);
  const h = t.sampleHeight(35, -106, tile, z)!;
  check('bilinear sample is exact on a linear surface', Math.abs(h - expect) < 0.05 * 1000, `${h} vs ${expect}`);
  // On a tile edge: the neighbour is read.
  const edgeLon = ((Math.floor(x) + 1) / 2 ** z) * 360 - 180; // the next tile's west edge
  const reads = new Set<string>();
  t.sampleHeight(35, edgeLon, (tx, ty) => (reads.add(`${tx}/${ty}`), tile(tx, ty)), z);
  check('a point on a tile edge reads both tiles', reads.size >= 2, [...reads].join(' '));
  check('a missing tile: no height', t.sampleHeight(35, -106, () => null, z) === null);
  check('tilesFor names what sampleHeight reads', t.tilesFor(35, edgeLon, z).length >= 2);
}

// ArduPilot's grid
{
  const o = t.apOffset(350000000, -1060000000, 100, 0);
  check(
    'offset 100 m north: 8983 (1e-7 deg), as Location::offset_latlng',
    o.lat === 350008983 && o.lon === -1060000000
  );
  const e = t.apOffset(350000000, -1060000000, 0, 100);
  check(
    'offset 100 m east: scaled by cos(lat)',
    e.lat === 350000000 && e.lon === -1060000000 + Math.trunc(8983.204953368922 / Math.cos((35 * Math.PI) / 180)),
    String(e.lon)
  );
  const p0 = t.subgridPoints(350000000, -1060000000, 100, 0);
  check(
    'sub-grid 0: 16 points from the block corner, x north then y east',
    p0.length === 16 &&
      near(p0[0].lat, 35) &&
      near(p0[0].lon, -106) &&
      p0[1].lat === p0[0].lat &&
      p0[1].lon > p0[0].lon &&
      p0[4].lat > p0[0].lat
  );
  const p9 = t.subgridPoints(350000000, -1060000000, 100, 9);
  const c9 = t.apOffset(350000000, -1060000000, 400, 400);
  check(
    'sub-grid 9 (row 1, column 1): starts 4 spacings north and east',
    near(p9[0].lat, c9.lat * 1e-7, 1e-9) && near(p9[0].lon, c9.lon * 1e-7, 1e-9)
  );
  check(
    'request mask bits',
    t.requestedGridbits(0b1010n | (1n << 55n)).join() === '1,3,55' && t.requestedGridbits(0n).length === 0
  );
  check('heights to int16, rounded', t.toTerrainInt16(1600.6) === 1601 && t.toTerrainInt16(99999) === 32767);
}

// The service with a fake network: a flat 1500 m world, one failing tile.
{
  let fetches = 0;
  const flat = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < 256 * 256; i++) flat.set([(1500 + 32768) >> 8, (1500 + 32768) & 255, 0, 255], i * 4);
  const svc = new TerrainService({
    fetchPng: async (url) => {
      fetches++;
      return url.includes('/9999/') ? null : new Blob(['png']);
    },
    decodePng: async () => flat,
  });
  const h = await svc.heightsAt([
    { lat: 35, lon: -106 },
    { lat: 35.001, lon: -106.001 },
  ]);
  check(
    'service: heights from fetched tiles',
    h.every((v) => v === 1500),
    h.join()
  );
  const before = fetches;
  await svc.heightAt(35.0005, -106.0005);
  check('service: tiles fetched once, then from memory', fetches === before);
  check(
    'service: heightNow uses only what is loaded',
    svc.heightNow(35, -106) === 1500 && svc.heightNow(10, 10) === null
  );
  svc.enabled = false;
  check('service: turned off answers nothing', (await svc.heightAt(35, -106)) === null);
}

// The server: sends one TERRAIN_DATA per requested sub-grid, readable by the parser; no double answers; gaps counted.
{
  const enc = new MavlinkEncoder();
  const sent: Uint8Array[] = [];
  let gate: (() => void) | null = null;
  const fake = {
    enabled: true,
    heightsAt: async (pts: any[]) => {
      if (gate === null) await new Promise<void>((r) => (gate = r));
      return pts.map((p: any, i: number) => (p.lat > 35.02 ? null : 1500 + i));
    },
  };
  const server = new TerrainServer(
    fake as any,
    (p) => void sent.push(p),
    (a, b, s, g, h) => enc.createTerrainData(a, b, s, g, h),
    () => {},
    0
  );
  const req = { mask: 0b101n, lat: 350000000, lon: -1060000000, grid_spacing: 100 };
  const first = server.handle(req);
  const dup = server.handle(req); // the vehicle asks again while the first is still fetching
  (gate as unknown as () => void)();
  const [r1, r2] = await Promise.all([first, dup]);
  check(
    'server: two sub-grids sent; a repeat request meanwhile adds none',
    r1.sent === 2 && r2.sent === 0 && sent.length === 2,
    `${r1.sent}+${r2.sent}`
  );
  const parsed = new MavlinkParser().parse(sent[1])[0];
  const v = new DataView(parsed.payload.buffer, parsed.payload.byteOffset);
  check(
    'TERRAIN_DATA: block corner, spacing, gridbit, 16 heights',
    parsed.messageId === 134 &&
      v.getInt32(0, true) === 350000000 &&
      v.getUint16(8, true) === 100 &&
      parsed.payload[42] === 2 &&
      v.getInt16(10, true) === 1516 &&
      v.getInt16(40, true) === 1531
  );
  const far = await server.handle({ mask: 1n, lat: 360000000, lon: -1060000000, grid_spacing: 100 });
  check(
    "server: a sub-grid the tiles can't cover is counted, not sent",
    far.sent === 0 && far.unavailable === 1 && sent.length === 2
  );

  // Pacing, and a link that goes: sends stop, failures aren't counted.
  const times: number[] = [];
  let up = 3;
  const flat = { enabled: true, heightsAt: async (pts: any[]) => pts.map(() => 1500) };
  const paced = new TerrainServer(
    flat as any,
    () => (times.push(Date.now()), up-- > 0),
    (a, b, s, g, h) => enc.createTerrainData(a, b, s, g, h),
    () => {},
    20
  );
  const r = await paced.handle({ mask: (1n << 8n) - 1n, lat: 350000000, lon: -1060000000, grid_spacing: 100 });
  check(
    'server: paced (~20 ms apart), not one burst',
    times.length >= 2 && times[1] - times[0] >= 15,
    times.map((x) => x - times[0]).join(',')
  );
  check(
    'server: when sending fails (link gone) it stops, counting only what went',
    r.sent === 3 && times.length === 4,
    `sent ${r.sent}, tried ${times.length}`
  );
  const none = await paced.handle({ mask: 0n, lat: 1, lon: 1, grid_spacing: 100 });
  check('server: nothing asked, nothing done', none.sent === 0 && none.unavailable === 0);
}

// Across the antimeridian: tiles wrap.
{
  const z = 12;
  const seen = new Set<number>();
  const v = t.sampleHeight(10, 179.99999, (tx) => (seen.add(tx), new Float32Array(256 * 256).fill(5)), z);
  check(
    'at 180 deg the tile west of it and tile 0 are read, never tile 2^z',
    v === 5 && seen.has(0) && !seen.has(2 ** z),
    [...seen].join(',')
  );
  check(
    'tilesFor wraps too',
    t.tilesFor(10, 179.99999, z).every((k) => k.x >= 0 && k.x < 2 ** z)
  );
}

console.log(failures.length ? `\n${failures.length} terrain check(s) FAILED` : '\nAll terrain checks PASSED');
process.exit(failures.length ? 1 : 0);
