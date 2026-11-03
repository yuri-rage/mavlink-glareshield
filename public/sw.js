const SHELL_CACHE = 'glareshield-shell-v1';
const TILE_CACHE = 'glareshield-tiles-v1';
const MAX_CACHED_TILES = 600;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/logo-64.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== TILE_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isMapTileRequest(url) {
  return (
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('arcgisonline.com')
  );
}

async function trimTileCache(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_CACHED_TILES) {
    const excess = keys.length - MAX_CACHED_TILES;
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i]);
    }
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cache-first with background refresh for map tiles (offline field use)
  if (isMapTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const networkFetch = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              cache.put(req, res.clone()).then(() => trimTileCache(cache));
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Same-origin app shell & assets: network-first falling back to cache
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/index.html')))
    );
  }
});
