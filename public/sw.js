/* Service Worker: safe caching and instant updates */
const CACHE_VERSION = "v6";
const STATIC_CACHE = `static-${CACHE_VERSION}`;

// Only cache immutable static assets. Do NOT cache HTML (like '/') to avoid stale UIs.
const STATIC_ASSETS = ["/logo.png"];

// Next.js build output (chunks, CSS, fonts, optimised images). Served network-first: production
// chunk names are content-hashed, so a fresh fetch is answered by the HTTP cache, while `next dev`
// reuses the same chunk URLs across edits and restarts, so a cache-first hit would serve stale code.
const NEXT_BUILD_PREFIX = "/_next/";

// Everything else with one of these destinations (e.g. the precached shell and images) stays
// cache-first so it keeps working offline.
const CACHE_FIRST_DESTINATIONS = ["script", "style", "image", "font"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Allow the page to tell SW to take control immediately
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never serve cached HTML. Fetch fresh app shell so users get latest code.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request));
    return;
  }

  // Network-first for API calls to avoid stale data; fall back to cache if available.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  if (request.method !== "GET") return;

  if (url.pathname.startsWith(NEXT_BUILD_PREFIX)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (CACHE_FIRST_DESTINATIONS.includes(request.destination)) {
    event.respondWith(cacheFirst(request));
  }
});
