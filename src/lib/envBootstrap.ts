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
/**
 * Same source name on both sides: `process.env.${key}` is overwritten with
 * `process.env.PREVIEW_${key}` when present.
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
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

/**
 * Cross-name aliases: Neon ships `PREVIEW_POSTGRES_PRISMA_URL`, but the
 * Prisma Postgres marketplace integration injects `PRISMA_DATABASE_URL` —
 * different prefix names for the same role. Map them explicitly with a
 * fallback to `PREVIEW_DATABASE_URL`.
 */
const CROSS_NAME_ALIASES: Array<{ target: string; sources: string[] }> = [
  {
    target: "PRISMA_DATABASE_URL",
    sources: ["PREVIEW_POSTGRES_PRISMA_URL", "PREVIEW_DATABASE_URL"],
  },
  {
    target: "DIRECT_URL",
    sources: [
      "PREVIEW_POSTGRES_URL_NON_POOLING",
      "PREVIEW_DATABASE_URL_UNPOOLED",
    ],
  },
];

for (const key of ALIASED_KEYS) {
  const previewValue = process.env[`PREVIEW_${key}`];
  if (!previewValue) continue;
  // Always overwrite when PREVIEW_* is present. The Prisma Postgres marketplace
  // integration silently injects DATABASE_URL / PRISMA_DATABASE_URL (the prod
  // Accelerate URL) into preview deploys; the explicit PREVIEW_* values must win.
  // Production env has no PREVIEW_* set, so this branch is a no-op there.
  process.env[key] = previewValue;
}

for (const { target, sources } of CROSS_NAME_ALIASES) {
  for (const source of sources) {
    const value = process.env[source];
    if (value) {
      process.env[target] = value;
      break;
    }
  }
}
