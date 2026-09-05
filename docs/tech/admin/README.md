# Admin

## Summary

Admin-only endpoints for status and user management.

## Entry Points

- API: `src/app/api/admin/**`
- UI: `src/app/admin/page.tsx`

## Functies (feature toggles)

Admin-controlled feature flags gate optional UI for everyone, hidden by default until an admin
turns them on. State is stored in KV as `{ enabled, updatedAt, updatedBy }` per flag (see
`src/lib/featureFlags.ts`), with an in-code default used when nothing is stored yet, the stored
value is malformed, or the read fails.

- API: `GET /api/admin/features` returns `{ flags }`; `PATCH` with `{ key, enabled }` updates one
  flag (`src/app/api/admin/features/route.ts`, admin-only like the rest of `src/app/api/admin/**`).
- UI: `src/components/admin/FeatureToggles.tsx`, mounted on the admin page — one switch row per
  flag, optimistic update with revert-on-failure.
- Currently one flag: `gtaH3Launcher` ("GTA H3 spel tonen"), hidden by default — see
  `docs/tech/arena/README.md`.
