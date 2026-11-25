// Offline tiles: tile maths, URLs as Leaflet builds them (so a kept tile is found again), MBTiles rows.
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { tileXY, tileRange, countTiles, tilesIn, tileUrl, mbtilesRowToY, validTemplate, importTileUrl } = await import('../src/lib/offlineTiles.ts');

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

console.log(failures.length ? `\n${failures.length} offline-tile check(s) FAILED` : '\nAll offline-tile checks PASSED');
process.exit(failures.length ? 1 : 0);
