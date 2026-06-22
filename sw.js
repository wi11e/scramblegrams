const CACHE = 'sg-v1';

const PRECACHE = [
  '/',
  '/style.css',
  '/js/app.js',
  '/js/elements.js',
  '/js/game.js',
  '/js/tiles.js',
  '/js/wordlist.js',
];

// Pre-cache app shell on install (wordlist cached lazily on first fetch)
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
});

// Delete old caches on activate
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first: serve from cache, fall through to network and cache the response
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      });
    })
  );
});
