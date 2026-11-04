// Service worker: keeps a copy of the app on this computer, so it opens with no internet.
// At build time vite.config.js fills in FILES (every file of this build) and VERSION, and writes
// the result to dist/sw.js. It never caches notes: those live in IndexedDB and Firestore.
//
// - The page itself: from the network when online (so a deploy shows up at once), else this copy.
// - Built files: their names change with their content, so the copy is always right.
// - Google Fonts: kept once fetched.
// Firebase's own paths (/__/), sign-in and Firestore are never touched.

const VERSION = '__VERSION__';
const FILES = __FILES__;
const CACHE = `colornote-app-${VERSION}`;
const FONTS = 'colornote-fonts';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name !== CACHE && name !== FONTS) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONTS));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.startsWith('/__/')) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cached = await caches.match('/index.html', { cacheName: CACHE });
        return cached || Response.error();
      }
    })());
    return;
  }
  event.respondWith(cacheFirst(req, CACHE));
});

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req, { cacheName });
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    const cache = await caches.open(cacheName);
    cache.put(req, res.clone());
  }
  return res;
}
