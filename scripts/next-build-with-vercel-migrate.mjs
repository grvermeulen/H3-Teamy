#!/usr/bin/env node
/**
 * Op Vercel kan `prisma migrate deploy` vóór `next build` draaien zodat het schema
 * actueel is (o.a. Passkey-tabel). Migraties vereisen meestal een directe Postgres-URL;
 * poolers (PgBouncer transaction mode) falen vaak — zelfde volgorde als `prisma.config.ts`.
 * Lokaal en in GitHub CI is `VERCEL` niet gezet — dan wordt alleen gebouwd.
 */
import { spawnSync } from "node:child_process";

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: false });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

/** Zelfde voorkeur als `prisma.config.ts` voor niet-gepoolde endpoints. */
function hasLikelyDirectMigrateUrl() {
  return Boolean(
    process.env.PREVIEW_DATABASE_URL_UNPOOLED ||
      process.env.PREVIEW_POSTGRES_URL_NON_POOLING ||
      process.env.DATABASE_URL_UNPOOLED ||
      process.env.POSTGRES_URL_NON_POOLING ||
      process.env.DIRECT_URL,
  );
}

if (process.env.VERCEL === "1") {
  if (hasLikelyDirectMigrateUrl()) {
    run("npx", ["prisma", "migrate", "deploy"]);
  } else {
    console.warn(
      "[build] prisma migrate deploy overgeslagen: geen directe Postgres-URL " +
        "(bijv. POSTGRES_URL_NON_POOLING of DIRECT_URL). Voer migraties handmatig uit of voeg deze variabele toe aan Vercel.",
    );
  }
}

run("npx", ["next", "build"]);
