// Replaced with a unique ID at build time (vite.config.ts), so every deploy has its own shell cache.
const BUILD_ID = '__BUILD_ID__';
const SHELL_PREFIX = 'glareshield-shell-';
const SHELL_CACHE = SHELL_PREFIX + BUILD_ID;
const TILE_CACHE = 'glareshield-tiles-v1';
const MAX_CACHED_TILES = 600;

// The neural voice's runtime, which its library (@diffusionstudio/vits-web) fetches from CDNs at every start: the
// phonemizer (jsDelivr, ~19 MB with its data) and the ONNX runtime's WebAssembly (cdnjs). Too big to precache for
// everyone, so kept cache-first in a cache of its own when the voice first loads them online (when its model
// downloads too), across deploys. The URLs are pinned versions; tests/voiceCache.test.ts checks they match the
// library's. Entries under other prefixes (an older library version) are dropped when a new worker activates.
const VOICE_CACHE = 'glareshield-voice-v1';
const VOICE_PREFIXES = [
  'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/',
  'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/',
];
const isVoiceRuntime = (url) => VOICE_PREFIXES.some((p) => url.startsWith(p));

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/logo-64.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
];

// This build's bundles and icons, filled in at build time (vite.config.ts); empty on the dev server. Cached at install
// so the lazily loaded parts of the app work offline without having been opened since this deploy.
const BUILD_ASSETS = /*__PRECACHE__*/ [];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        Promise.all([
          // One by one, as the build's files: with addAll, one failure (a flaky connection) dropped all of them,
          // index.html included.
          ...SHELL_ASSETS.map((url) => cache.add(url).catch(() => {})),
          // One by one: a file that fails (a flaky connection) doesn't stop the rest; it is cached when first fetched.
          ...BUILD_ASSETS.map((url) => cache.add(url).catch(() => {})),
        ])
      )
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
      .then(() =>
        caches
          .open(VOICE_CACHE)
          .then((cache) =>
            cache
              .keys()
              .then((reqs) => Promise.all(reqs.filter((r) => !isVoiceRuntime(r.url)).map((r) => cache.delete(r))))
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

  // The voice's runtime: cache-first (pinned versions never change), so the voice speaks offline.
  if (isVoiceRuntime(req.url)) {
    event.respondWith(
      caches.open(VOICE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res && res.ok && res.type !== 'opaque') cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

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
          // Offline with nothing cached: a network error, not undefined (which respondWith rejects as a TypeError).
          .catch(() => cached || Response.error());
        return cached || networkFetch;
      })
    );
    return;
  }

  // Same-origin app shell & assets: network-first falling back to cache. API calls are never cached, nor the deployed
  // build's version (the app polls it with a cache-busting query: each poll would be a new cache entry).
  if (url.origin === self.location.origin && !url.pathname.startsWith('/api/') && url.pathname !== '/version.json') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        // Offline: the cached copy, or for a page load the app shell. A missing script, style or data file stays a
        // network error; answering it with index.html (status 200) made the failure look like a parse error.
        .catch(() =>
          caches.match(req).then((c) => c || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error()))
        )
    );
  }
});
