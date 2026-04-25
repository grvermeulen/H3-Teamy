#!/usr/bin/env npx tsx
/**
 * Fails the process if any tracked-style source under `src/` contains Git merge conflict markers.
 * Used in CI (Agentic CI) to prevent Turbopack/Next parse errors like JAVASCRIPT-NEXTJS-16.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { findMergeConflictMarkerOccurrences } from "../src/lib/mergeConflictMarkers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const ROOT = join(REPO_ROOT, "src");
const EXT = /\.(ts|tsx|js|mjs|cjs|css)$/i;

function walk(dir: string, files: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p, files);
    } else if (EXT.test(name)) {
      files.push(p);
    }
  }
}

function main(): void {
  const files: string[] = [];
  walk(ROOT, files);
  const all: string[] = [];
  for (const abs of files.sort()) {
    const text = readFileSync(abs, "utf8");
    const rel = relative(REPO_ROOT, abs);
    all.push(...findMergeConflictMarkerOccurrences(text, rel));
  }
  if (all.length > 0) {
    console.error("Merge conflict markers gevonden in broncode:");
    for (const line of all) {
      console.error(`  ${line}`);
    }
    process.exit(1);
  }
}

main();
