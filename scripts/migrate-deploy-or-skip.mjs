#!/usr/bin/env node
/**
 * Runs `prisma migrate deploy` when any known Postgres URL env is set; otherwise exits 0.
 * Prefers unpooled/direct URLs so DDL works on hosts that reject migrations on poolers.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const URL_KEYS = [
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "DIRECT_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "PRISMA_DATABASE_URL",
];

function pickDatabaseUrl() {
  for (const key of URL_KEYS) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

const url = pickDatabaseUrl();
if (!url) {
  console.warn(
    "[migrate-deploy] Geen database-URL gevonden; migrate deploy wordt overgeslagen (alleen build).",
  );
  process.exit(0);
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});

process.exit(result.status === null ? 1 : result.status);
