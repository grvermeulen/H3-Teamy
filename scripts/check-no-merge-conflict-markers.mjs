#!/usr/bin/env node
/**
 * Fails if any tracked source file under src/ contains Git merge conflict markers.
 * Prevents recurrence of Turbopack/PostCSS parse errors (e.g. JAVASCRIPT-NEXTJS-14, JAVASCRIPT-NEXTJS-17:
 * CssSyntaxError "Unknown word HEAD" when `<<<<<<< HEAD` is left in globals.css).
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(__dirname, "..");
const srcRoot = join(repoRoot, "src");

const MARKERS = ["<<<<<<<", "=======", ">>>>>>>"];

/** @param {string} line */
function lineHasMarker(line) {
  const t = line.trimStart();
  return MARKERS.some((m) => t.startsWith(m));
}

/** @param {string} content */
function badLines(content) {
  const lines = content.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lineHasMarker(lines[i])) out.push(i + 1);
  }
  return out;
}

/** @param {string} dir */
async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      yield* walk(p);
    } else if (
      /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css)$/.test(e.name) &&
      !/\.(test|spec)\.(ts|tsx|mts|cts|js|jsx)$/.test(e.name)
    ) {
      yield p;
    }
  }
}

async function main() {
  const violations = [];
  try {
    for await (const file of walk(srcRoot)) {
      const content = await readFile(file, "utf8");
      const lines = badLines(content);
      if (lines.length) {
        violations.push({
          file: relative(repoRoot, file),
          lines,
        });
      }
    }
  } catch (e) {
    console.error("check-no-merge-conflict-markers:", e);
    process.exit(1);
  }

  if (violations.length) {
    console.error("Merge conflict markers found in source (remove before commit):");
    for (const v of violations) {
      console.error(`  ${v.file}: lines ${v.lines.join(", ")}`);
    }
    process.exit(1);
  }
}

await main();
