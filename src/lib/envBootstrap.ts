/**
 * Aliases `PREVIEW_*` env vars to their unprefixed counterparts at module load.
 *
 * Background: the Vercel Marketplace integrations attached to the Preview environment
 * (Neon for Postgres, Upstash for Redis/KV) namespace every variable they provision
 * with the resource name (`PREVIEW_DATABASE_URL`, `PREVIEW_REDIS_URL`, …). The
 * runtime code reads the canonical, unprefixed names. By copying the prefixed values
 * over once when the server module graph initialises, no other file needs to know
 * the integration prefix exists.
 *
 * Production has no `PREVIEW_*` vars set, so this is a no-op there.
 *
 * Side effect: mutates `process.env`. Imported only by server modules (db.ts, kv.ts).
 */
const ALIASED_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "DIRECT_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_PRISMA_URL",
  "PRISMA_DATABASE_URL",
  "REDIS_URL",
  "KV_URL",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "KV_REST_API_READ_ONLY_TOKEN",
] as const;

for (const key of ALIASED_KEYS) {
  const previewValue = process.env[`PREVIEW_${key}`];
  if (!previewValue) continue;
  // Always overwrite when PREVIEW_* is present. The Prisma Postgres marketplace
  // integration silently injects DATABASE_URL / PRISMA_DATABASE_URL (the prod
  // Accelerate URL) into preview deploys; the explicit PREVIEW_* values must win.
  // Production env has no PREVIEW_* set, so this branch is a no-op there.
  process.env[key] = previewValue;
}
