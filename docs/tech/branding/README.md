# Branding

## Summary

The H3 badge (red H, white 3, black rounded square) is the app's logo everywhere: the header, the PWA manifest
icons, the apple-touch-icon and the favicon. A full-screen portrait splash screen shows once per browser session
while the app loads. A landscape artwork is generated alongside it, reserved for the arena game's loading screen.

What lives where:

- `assets/branding/` — the source artwork (full-resolution PNGs, not served directly).
- `public/icons/` — generated app icons (apple-touch-icon, manifest icons, maskable icon).
- `public/logo.png`, `src/app/icon.png` — generated header logo and favicon source.
- `public/branding/` — generated, optimised WebP/JPEG splash images served to the browser.
- `src/components/AppSplash.tsx` — the app-loading splash screen component.
- `src/components/cityArena/CityArenaLaunchIcon.tsx` — the GTA H3 launcher card icon.

## Entry Points

- Sources: `assets/branding/logo-h3.png`, `assets/branding/splash-app-portrait.png`,
  `assets/branding/splash-game-landscape.png`, `assets/branding/wasted-screen.png`,
  `assets/branding/gta-h3-logo.png`.
- Generation script: `scripts/generate-icons.js` (runs as the `prebuild` npm script; also runnable manually).
- Splash screen component: `src/components/AppSplash.tsx`.
- PWA manifest: `src/app/manifest.ts`.

## How to replace artwork

1. Drop the new artwork into `assets/branding/`, keeping the existing file names
   (`logo-h3.png`, `splash-app-portrait.png`, `splash-game-landscape.png`).
2. Run `node scripts/generate-icons.js` to regenerate the icons and splash images.
3. Commit the updated sources together with the regenerated outputs in `public/icons/`, `public/branding/`,
   `public/logo.png` and `src/app/icon.png`.

## Game loading screen

`public/branding/wasted-screen.{webp,jpg}` is the arena death-screen artwork (design spec §7, built in Plan 4).
`public/branding/splash-game-landscape.{webp,jpg}` is reserved for the arena game's loading screen; wiring it into
the game UI is left to a later PR. The owner accepted the artwork as delivered on 2026-09-03.

## GTA H3 launcher icon

`public/branding/gta-h3-logo.{webp,png}` is the owner's logo artwork for the GTA H3 launcher card, generated from
`assets/branding/gta-h3-logo.png` (1254 × 1254). The WebP keeps the source resolution; the PNG fallback is resized
to 256 × 256 (`fit: "cover"`) since it's only used as the `<picture>` fallback for browsers without WebP support.
Rendered by `src/components/cityArena/CityArenaLaunchIcon.tsx`.
