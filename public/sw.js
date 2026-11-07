// Replaced with a unique ID at build time (vite.config.ts), so every deploy has its own shell cache.
const BUILD_ID = '__BUILD_ID__';
const SHELL_PREFIX = 'glareshield-shell-';
const SHELL_CACHE = SHELL_PREFIX + BUILD_ID;
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
          // Earlier deploys' shells (and their hashed bundles) are dropped. Every other cache (map tiles, the
          // app's parameter metadata) is kept.
          keys
            .filter((k) => k.startsWith(SHELL_PREFIX) && k !== SHELL_CACHE)
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
            // Only cache valid CORS / same-origin responses; never cache opaque responses
            // to avoid Chrome inflating quota to ~7MB per opaque tile.
            if (res && res.ok && res.type !== 'opaque') {
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

  // Same-origin app shell & assets: network-first falling back to cache. API calls are never cached.
  if (url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/index.html')))
    );
  }
});
