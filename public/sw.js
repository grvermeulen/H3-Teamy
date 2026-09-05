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

/**
 * Stores a successful response in the cache, keeping the worker alive until the write completes
 * (`respondWith` only covers the response itself).
 */
function cacheResponse(event, cache, response) {
  if (!response.ok) return;
  event.waitUntil(cache.put(event.request, response.clone()));
}

/**
 * Fetches from the network and refreshes the cache on success; serves the cached copy only when
 * the network fails, so a fresh response always wins while the server is reachable.
 */
async function networkFirst(event) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(event.request);
    cacheResponse(event, cache, response);
    return response;
  } catch (error) {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    throw error;
  }
}

/**
 * Serves the cached copy when present and otherwise fetches and caches the response, so the
 * precached shell and images keep working offline.
 */
async function cacheFirst(event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  cacheResponse(event, cache, response);
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
    event.respondWith(networkFirst(event));
    return;
  }

  if (CACHE_FIRST_DESTINATIONS.includes(request.destination)) {
    event.respondWith(cacheFirst(event));
  }
});
