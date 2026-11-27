// The service worker (public/sw.js), run in a sandbox with fake caches and network: the build's hashed bundles come
// from the cache without waiting on the network, pages stay network-first, and a burst of map tiles leaves the tile
// cache at its limit.
import fs from 'node:fs';
import vm from 'node:vm';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

class FakeResponse {
  ok = true;
  type = 'basic';
  constructor(public body: string) {}
  clone() {
    return new FakeResponse(this.body);
  }
  static error() {
    return new FakeResponse('ERROR');
  }
}
class FakeCache {
  entries = new Map<string, FakeResponse>();
  async match(req: any) {
    return this.entries.get(typeof req === 'string' ? req : req.url);
  }
  async put(req: any, res: FakeResponse) {
    await new Promise((r) => setTimeout(r, Math.random() * 3));
    this.entries.set(typeof req === 'string' ? req : req.url, res);
  }
  async add(url: string) {
    this.entries.set(url, new FakeResponse(`net:${url}`));
  }
  async keys() {
    await new Promise((r) => setTimeout(r, Math.random() * 3));
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(req: any) {
    await new Promise((r) => setTimeout(r, Math.random() * 3));
    return this.entries.delete(typeof req === 'string' ? req : req.url);
  }
}
const stores = new Map<string, FakeCache>();
const caches = {
  open: async (name: string) =>
    stores.has(name) ? stores.get(name)! : (stores.set(name, new FakeCache()), stores.get(name)!),
  match: async (req: any) => {
    for (const c of stores.values()) {
      const hit = await c.match(req);
      if (hit) return hit;
    }
    return undefined;
  },
  keys: async () => [...stores.keys()],
  delete: async (name: string) => stores.delete(name),
};
let fetches: string[] = [];
let online = true;
const fetchFn = async (req: any) => {
  const url = typeof req === 'string' ? req : req.url;
  fetches.push(url);
  await new Promise((r) => setTimeout(r, 2));
  if (!online) throw new TypeError('offline');
  return new FakeResponse(`net:${url}`);
};
const handlers: Record<string, (e: any) => void> = {};
const self = {
  location: { origin: 'https://glareshield.yurirage.com' },
  addEventListener: (type: string, h: (e: any) => void) => (handlers[type] = h),
  skipWaiting: () => {},
  clients: { claim: async () => {} },
};
vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), {
  self,
  caches,
  fetch: fetchFn,
  Response: FakeResponse,
  URL,
  console,
  setTimeout,
});

const get = async (url: string, mode = 'no-cors') => {
  let p: Promise<FakeResponse> | undefined;
  handlers.fetch({ request: { url, method: 'GET', mode }, respondWith: (r: Promise<FakeResponse>) => (p = r) });
  return p ? await p : undefined;
};
const shell = async () => (await caches.open('glareshield-shell-__BUILD_ID__')) as FakeCache;

// A bundle the install cached: from the cache, with no request at all.
const ORIGIN = 'https://glareshield.yurirage.com';
(await shell()).entries.set(`${ORIGIN}/assets/MapWidget-abc123.js`, new FakeResponse('cached bundle'));
fetches = [];
let r = await get(`${ORIGIN}/assets/MapWidget-abc123.js`);
check('a cached bundle: served from the cache', r?.body === 'cached bundle');
check('a cached bundle: no network request', fetches.length === 0, fetches.join(','));

// One not cached yet: fetched once, then kept.
r = await get(`${ORIGIN}/assets/Gimbal-def456.js`);
check('an uncached bundle: fetched', r?.body === `net:${ORIGIN}/assets/Gimbal-def456.js`);
await new Promise((r2) => setTimeout(r2, 20));
fetches = [];
r = await get(`${ORIGIN}/assets/Gimbal-def456.js`);
check('then kept: the next load needs no request', fetches.length === 0 && r?.body?.startsWith('net:') === true);

// Pages stay network-first (a new deploy's index.html must come through).
fetches = [];
r = await get(`${ORIGIN}/`, 'navigate');
check('a page load: network-first', fetches.length === 1 && r?.body === `net:${ORIGIN}/`);
online = false;
r = await get(`${ORIGIN}/`, 'navigate');
check('a page load offline: the cached copy', r?.body === `net:${ORIGIN}/`);
online = true;

// A burst of map tiles: the tile cache ends at its limit (600).
await Promise.all(Array.from({ length: 700 }, (_, i) => get(`https://a.tile.openstreetmap.org/12/${i}/1.png`)));
// Let the puts and the queued trims finish.
for (let i = 0; i < 300; i++) await new Promise((r2) => setTimeout(r2, 5));
const tiles = (await caches.open('glareshield-tiles-v1')) as FakeCache;
check('700 tiles in a burst: the tile cache ends at 600', tiles.entries.size === 600, `${tiles.entries.size}`);

console.log(
  failures.length ? `\n${failures.length} service-worker check(s) FAILED` : '\nAll service-worker checks PASSED'
);
if (failures.length) process.exit(1);
