// Offline tiles: tile maths, URLs as Leaflet builds them (so a kept tile is found again), MBTiles rows.
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { tileXY, tileRange, tileRanges, countTiles, tilesIn, tileUrl, mbtilesRowToY, validTemplate, importTileUrl } = await import('../src/lib/offlineTiles.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

check('zoom 0: one tile', JSON.stringify(tileXY(35, -106, 0)) === '{"x":0,"y":0}');
// Known tile: Albuquerque at z12: x = floor(73.3496 / 360 * 4096) = 834, y = floor(0.395815 * 4096) = 1621.
const t = tileXY(35.0844, -106.6504, 12);
check('tile of a point at z12 (slippy-map formula)', t.x === 834 && t.y === 1621, JSON.stringify(t));
const b = { south: 35.0, west: -106.01, north: 35.01, east: -106.0 };
const r = tileRange(b, 16);
check('range covers the bounds, north row first', r.x0 <= r.x1 && r.y0 <= r.y1);
check('count = sum of range sizes', countTiles(b, 15, 16) === [15, 16].reduce((n, z) => { const q = tileRange(b, z); return n + (q.x1 - q.x0 + 1) * (q.y1 - q.y0 + 1); }, 0));
check('tilesIn yields exactly count', [...tilesIn(b, 14, 17)].length === countTiles(b, 14, 17));
check('poles clamped (no NaN rows)', Number.isFinite(tileXY(89.9, 0, 5).y) && tileXY(89.9, 0, 5).y === 0 && tileXY(-89.9, 0, 5).y === 31);

// The URL Leaflet requests for a tile (TileLayer.getTileUrl / _getSubdomain: subdomains[|x + y| % n]; {r} '' without
// retina), so a kept or downloaded tile has the address the map asks for.
const leafletUrl = (x: number, y: number, z: number) => `https://${'abc'[Math.abs(x + y) % 3]}.example.com/${z}/${x}/${y}.png`;
let same = true;
let sample = '';
for (const [x, y] of [[0, 0], [1, 0], [5, 7], [834, 1617], [100, 3]]) {
  const ours = tileUrl('https://{s}.example.com/{z}/{x}/{y}{r}.png', 12, x, y, 'abc');
  if (leafletUrl(x, y, 12) !== ours) { same = false; sample = `${leafletUrl(x, y, 12)} vs ${ours}`; }
}
check('tile URLs match Leaflet\'s (subdomain picked by |x+y| mod n)', same, sample);
check('{-y}: TMS row', tileUrl('https://h/{z}/{x}/{-y}.png', 3, 1, 2) === 'https://h/3/1/5.png');
check('MBTiles row to XYZ y', mbtilesRowToY(3, 5) === 2 && mbtilesRowToY(0, 0) === 0);
check('valid template: z, x, y over http(s)', validTemplate('https://t/{z}/{x}/{y}.png') && validTemplate('http://t/{z}/{x}/{-y}.jpg') && !validTemplate('https://t/{z}/{x}.png') && !validTemplate('ftp://t/{z}/{x}/{y}'));
check('import addresses', importTileUrl('abc', 4, 3, 2) === 'https://offline.glareshield.invalid/abc/4/3/2');

// Review: retina, empty subdomains, repeated placeholders, the antimeridian.
check('{r} is @2x on a high-density screen (as Leaflet adds it)', tileUrl('https://h/{z}/{x}/{y}{r}.png', 1, 0, 0, 'abc', true) === 'https://h/1/0/0@2x.png');
check('empty subdomains: Leaflet\'s default abc (as the map layer gets)', tileUrl('https://{s}.h/{z}/{x}/{y}', 1, 1, 0, '') === 'https://b.h/1/1/0');
check('every occurrence replaced', tileUrl('https://h/{z}/{x}/{y}?z={z}', 4, 1, 2) === 'https://h/4/1/2?z=4');
const across = { south: 0, west: 179, north: 1, east: 181 }; // panned across the antimeridian: east beyond 180
const rs = tileRanges(across, 6);
check('across the antimeridian: two ranges, each side', rs.length === 2 && rs[0].x1 === 63 && rs[1].x0 === 0, JSON.stringify(rs));
check('...counted positive, both sides', countTiles(across, 6, 6) === (rs[0].x1 - rs[0].x0 + 1 + rs[1].x1 - rs[1].x0 + 1) * (rs[0].y1 - rs[0].y0 + 1) && countTiles(across, 6, 6) > 0);
check('west > east (normalised) also wraps', tileRanges({ south: 0, west: 179, north: 1, east: -179 }, 6).length === 2);
check('wider than the world: every column once', tileRanges({ south: 0, west: -200, north: 1, east: 200 }, 3).length === 1 && tileRanges({ south: 0, west: -200, north: 1, east: 200 }, 3)[0].x1 === 7);

check('an east edge exactly on 180: one range, ending at the last column', (() => { const r = tileRanges({ south: 0, west: 170, north: 1, east: 180 }, 4); return r.length === 1 && r[0].x1 === 15; })(), JSON.stringify(tileRanges({ south: 0, west: 170, north: 1, east: 180 }, 4)));

console.log(failures.length ? `\n${failures.length} offline-tile check(s) FAILED` : '\nAll offline-tile checks PASSED');
process.exit(failures.length ? 1 : 0);
