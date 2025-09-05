/* Service Worker: safe caching and instant updates */
const CACHE_VERSION = 'v3';
const STATIC_CACHE = `static-${CACHE_VERSION}`;

// Only cache immutable static assets. Do NOT cache HTML (like '/') to avoid stale UIs.
const STATIC_ASSETS = [
  '/logo.svg',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Allow the page to tell SW to take control immediately
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never serve cached HTML. Fetch fresh app shell so users get latest code.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request));
    return;
  }

  // Network-first for API calls to avoid stale data; fall back to cache if available.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  // Cache-first for static assets
  const cacheableDestinations = ['script', 'style', 'image', 'font'];
  if (cacheableDestinations.includes(request.destination)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (request.method === 'GET' && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })
    );
  }
});
