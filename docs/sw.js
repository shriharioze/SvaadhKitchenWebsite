const CACHE_NAME = 'svaadh-cache-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/order.html',
  '/favicon.svg',
  '/images/svaadh-kitchen-hero.PNG',
  '/i18n.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
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

// Network-first strategy — only for same-origin static assets.
// NEVER intercept API calls (script.google.com) — causes "null response" failures.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;
  // Skip all cross-origin / API requests — let browser handle them natively
  if (url.includes('script.google.com') || url.includes('macros/s/')
      || !url.startsWith(self.location.origin)) {
    return; // don't call event.respondWith — browser handles it
  }

  // Page navigations bypass the browser HTTP cache (cache:'no-cache' forces an
  // ETag revalidation with GitHub Pages — a cheap 304 when unchanged) so a new
  // deploy reaches every customer on their NEXT page load instead of being pinned
  // by the ~10-minute Pages cache. Offline still falls back to the SW cache.
  const isNav = event.request.mode === 'navigate';
  const netFetch = isNav
    ? fetch(event.request.url, { cache: 'no-cache' })
    : fetch(event.request);
  event.respondWith(
    netFetch
      .catch(() => caches.match(event.request))
      .then(response => response || fetch(event.request))
  );
});
