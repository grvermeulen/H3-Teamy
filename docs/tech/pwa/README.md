# PWA service worker

## Summary

`public/sw.js` gives the installed app (manifest in `src/app/manifest.ts`) a precached shell and offline images.
It is registered by `src/components/ServiceWorkerRegistration.tsx` (rendered from `src/app/layout.tsx`) on
production builds only. On every other build the component registers nothing and instead removes any worker
left behind by a production build or a local `next start`, together with its caches, so `next dev` never runs
stale chunks.

## Caching strategy (`static-v6`)

| Request                                                          | Strategy                      | Why                                                                                                                                                                           |
| ---------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigations (HTML)                                               | Network only                  | Never serve a stale app shell.                                                                                                                                                |
| `/api/*`                                                         | Network first                 | Fresh data; the cache is only a fallback.                                                                                                                                     |
| `/_next/*` (chunks, CSS, fonts, optimised images)                | Network first, cache fallback | Production chunk names are content-hashed, so a fresh fetch is answered by the HTTP cache; `next dev` reuses the same chunk URLs across edits, so a cache hit would be stale. |
| Other `GET` scripts, styles, images and fonts (e.g. `/logo.png`) | Cache first                   | Keeps the precached shell and images working offline.                                                                                                                         |

Bump `CACHE_VERSION` in `public/sw.js` whenever the strategy or the precached list changes; the `activate`
handler deletes every older cache.

## Entry Points

- Worker: `public/sw.js`.
- Registration policy: `src/lib/serviceWorkerRegistration.ts` (`shouldRegisterServiceWorker`, `setupServiceWorker`).
- Mount point: `src/components/ServiceWorkerRegistration.tsx`.
