/**
 * Verifies the local env file looks like preview, not production.
 * Run before `next dev` so we never accidentally develop against prod.
 *
 *   PREVIEW_ENV_FILE=.env.preview.local tsx scripts/check-preview-env.ts
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILE = process.env.PREVIEW_ENV_FILE ?? ".env.preview.local";
const REQUIRED_ANY_OF: ReadonlyArray<readonly string[]> = [
  ["PREVIEW_DATABASE_URL", "DATABASE_URL"],
  ["PREVIEW_REDIS_URL", "REDIS_URL"],
];
const REQUIRED = ["NEXTAUTH_SECRET", "INVITATION_CODE"];

function readEnv(file: string): Record<string, string> {
  const path = resolve(file);
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(raw.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = readEnv(ENV_FILE);
if (Object.keys(env).length === 0) {
  console.error(
    `✖ ${ENV_FILE} not found. Run: vercel env pull ${ENV_FILE} --environment=preview`,
  );
  process.exit(1);
}

const missing = REQUIRED.filter((k) => !env[k] || env[k] === "");
const missingGroups = REQUIRED_ANY_OF.filter(
  (group) => !group.some((k) => env[k] && env[k] !== ""),
);
if (missing.length || missingGroups.length) {
  if (missing.length) {
    console.error(`✖ Preview env file is missing: ${missing.join(", ")}`);
  }
  for (const group of missingGroups) {
    console.error(
      `✖ Preview env file needs at least one of: ${group.join(" OR ")}`,
    );
  }
  process.exit(2);
}

const target = env.VERCEL_TARGET_ENV ?? env.VERCEL_ENV;
if (target && target !== "preview") {
  console.error(
    `✖ ${ENV_FILE} has VERCEL_TARGET_ENV="${target}" — expected "preview".`,
  );
  process.exit(3);
}

const dbUrl =
  env.PREVIEW_POSTGRES_PRISMA_URL ||
  env.PREVIEW_DATABASE_URL ||
  env.PREVIEW_POSTGRES_URL ||
  env.PRISMA_DATABASE_URL ||
  env.DATABASE_URL ||
  env.POSTGRES_URL ||
  "";
const PROD_TENANT =
  "e7fcde367d223f28991c47fe9d7da827fd1277513b2c7ec8f72bc1e82bd63a8e";
if (dbUrl.includes(PROD_TENANT)) {
  console.error(
    "✖ Preview DB URL contains the production Prisma Postgres tenant id.\n" +
      "   Provision a separate database for preview and update PREVIEW_DATABASE_URL / DATABASE_URL in the Preview scope.",
  );
  process.exit(4);
}

console.log(`✓ ${ENV_FILE} looks like a real preview environment.`);
