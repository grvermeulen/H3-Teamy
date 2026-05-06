#!/usr/bin/env node
/**
 * Op Vercel draait `prisma migrate deploy` vóór `next build`, zodat preview/productie
 * het schema hebben voordat de app queries uitvoert (o.a. Passkey-tabel).
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

if (process.env.VERCEL === "1") {
  run("npx", ["prisma", "migrate", "deploy"]);
}

run("npx", ["next", "build"]);
