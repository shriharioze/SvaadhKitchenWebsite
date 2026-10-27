// Read claude.md and bump version number for pages with changes
const CACHE_NAME = 'svaadh-cache-v4';
const urlsToCache = [
  '/',
  '/index.html',
  '/order.html',
  '/Liviano-Serio.html',
  '/favicon.svg',
  '/images/svaadh-kitchen-hero.PNG',
  '/i18n.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Individual cache adds so a single missing file doesn't fail the whole install
        return Promise.allSettled(urlsToCache.map(u => cache.add(u)));
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Network-first strategy for static assets.
// NEVER intercept page navigations — let the browser handle HTML navigations natively.
// Intercepting navigations in WebKit / Safari causes fatal connection drops:
// "Safari could not open the page because the server stopped responding"
// whenever redirected (HTTP->HTTPS, non-www->www) or under slow cellular networks.
// NEVER intercept API calls (script.google.com) — causes "null response" failures.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Let browser handle all page navigations natively
  if (event.request.mode === 'navigate') return;

  const url = event.request.url;
  // Skip all cross-origin / API requests — let browser handle them natively
  if (url.includes('script.google.com') || url.includes('macros/s/')
      || !url.startsWith(self.location.origin)) {
    return; // don't call event.respondWith — browser handles it
  }

  // Same-origin static assets: stale-while-revalidate with cache fallback
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const fetchPromise = fetch(event.request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          }).catch(() => {});
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
