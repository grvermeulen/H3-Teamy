import fs from "fs";
import path from "path";
import { isMainModule } from "./utils.ts";

/** Matches `api/.../route.ts|js` beneath the app directory; expects a POSIX path. */
const API_ROUTE_FILE_PATTERN = /\/api\/.+\/route\.[tj]s$/;
/** Matches `.../page.tsx|ts|jsx|js` beneath the app directory; expects a POSIX path. */
const PAGE_FILE_PATTERN = /\/page\.[tj]sx?$/;

/** URL paths of the API route handlers and pages found under `src/app`. */
export interface RoutesInventory {
  apiRoutes: string[];
  pages: string[];
}

/**
 * Normalises an OS-specific path to POSIX separators. `path.join` yields
 * backslashes on Windows, which the forward-slash patterns above never match.
 */
export function toPosixPath(filePath: string): string {
  return filePath.split(path.win32.sep).join(path.posix.sep);
}

/** Whether `filePath` is a Next.js API route handler (`api/.../route.ts`). */
export function isApiRouteFile(filePath: string): boolean {
  return API_ROUTE_FILE_PATTERN.test(toPosixPath(filePath));
}

/** Whether `filePath` is a Next.js page (`.../page.tsx`). */
export function isPageFile(filePath: string): boolean {
  return PAGE_FILE_PATTERN.test(toPosixPath(filePath));
}

/** Maps `<appDir>/api/foo/bar/route.ts` to `/api/foo/bar`. */
export function toRoute(appDir: string, filePath: string): string {
  return toAppUrl(appDir, filePath).replace(/\/route\.[tj]s$/, "");
}

/** Maps `<appDir>/foo/bar/page.tsx` to `/foo/bar`; the root page maps to `/`. */
export function toPage(appDir: string, filePath: string): string {
  return toAppUrl(appDir, filePath).replace(/\/page\.[tj]sx?$/, "") || "/";
}

/**
 * Scans `appDir` recursively and returns the sorted URL paths of every API
 * route handler and page it contains.
 */
export function collectRoutes(appDir: string): RoutesInventory {
  const files = listFiles(appDir);
  return {
    apiRoutes: files
      .filter(isApiRouteFile)
      .map((file) => toRoute(appDir, file))
      .sort(),
    pages: files
      .filter(isPageFile)
      .map((file) => toPage(appDir, file))
      .sort(),
  };
}

/** Renders the inventory as the Markdown injected into `docs/specs/functional.md`. */
export function renderRoutesMarkdown(inventory: RoutesInventory): string {
  const lines: string[] = ["# Routes Inventory\n", "## API Routes\n"];
  for (const route of inventory.apiRoutes) lines.push(`- ${route}`);
  lines.push("\n## Pages\n");
  for (const page of inventory.pages) lines.push(`- ${page}`);
  return lines.join("\n");
}

function toAppUrl(appDir: string, filePath: string): string {
  const relative = path.posix.relative(
    toPosixPath(appDir),
    toPosixPath(filePath),
  );
  return `/${relative}`;
}

function listFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) listFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

function main(): void {
  const root = process.cwd();
  const appDir = path.join(root, "src/app");
  const inventory = collectRoutes(appDir);
  if (inventory.apiRoutes.length === 0 || inventory.pages.length === 0) {
    throw new Error(
      `No API routes or pages found under ${appDir}; refusing to write an empty inventory.`,
    );
  }
  const outDir = path.join(root, "docs/_generated");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "routes.md"),
    renderRoutesMarkdown(inventory),
  );
  console.log("Wrote docs/_generated/routes.md");
}

if (isMainModule(import.meta.url)) main();
