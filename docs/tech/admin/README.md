# Admin

## Summary

Admin-only endpoints for status and user management.

## Entry Points

- API: `src/app/api/admin/**`
- UI: `src/app/admin/page.tsx`

## Functies (feature toggles)

Admin-controlled feature flags gate optional UI for everyone, hidden by default until an admin
turns them on. State is stored in Postgres, one row per flag in the `FeatureFlag` table
(`key`, `enabled`, `updatedAt`, `updatedBy` — migration `add_feature_flag`; see
`src/lib/featureFlags.ts`), so every server instance reads the same value. An in-code default
(hidden) is used when no row is stored yet or the read fails.

- API: `GET /api/admin/features` returns `{ flags }`; `PATCH` with `{ key, enabled }` updates one
  flag (`src/app/api/admin/features/route.ts`, admin-only like the rest of `src/app/api/admin/**`).
- UI: `src/components/admin/FeatureToggles.tsx`, mounted on the admin page — one switch row per
  flag, optimistic update with revert-on-failure.
- Currently one flag: `gtaH3Launcher` ("GTA H3 spel tonen"), hidden by default — see
  `docs/tech/arena/README.md`.
