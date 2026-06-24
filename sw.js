const CACHE = 'sg-v2';

const PRECACHE = [
  '/',
  '/style.css',
  '/js/app.js',
  '/js/elements.js',
  '/js/game.js',
  '/js/tiles.js',
  '/js/wordlist.js',
];

// Always fetch fresh from the network for dynamic content
const NETWORK_FIRST = ['/api/', '/puzzles.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const { pathname } = new URL(e.request.url);

  // Network-first: API calls and puzzle data are always fresh
  if (NETWORK_FIRST.some(p => pathname.startsWith(p))) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first: app shell
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
