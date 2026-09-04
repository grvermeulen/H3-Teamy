import fs from "fs";
import { pathToFileURL } from "url";

/**
 * Replaces the block between `<!-- marker -->` and `<!-- /marker -->` in
 * `filePath` with `content`, keeping the marker comments in place.
 */
export function injectSection(
  filePath: string,
  marker: string,
  content: string,
): void {
  const start = `<!-- ${marker} -->`;
  const end = `<!-- /${marker} -->`;
  const src = fs.readFileSync(filePath, "utf8");
  const next = src.replace(
    new RegExp(`${start}[\\n\\r\\s\\S]*?${end}`),
    `${start}\n${content}\n${end}`,
  );
  fs.writeFileSync(filePath, next);
}

/**
 * Whether the module at `moduleUrl` (pass `import.meta.url`) is the script that
 * started this process, rather than a module imported by another script or a
 * test. Errors thrown by the script's `main()` must propagate, so callers use
 * this as a plain `if` instead of wrapping `main()` in a `try/catch`.
 */
export function isMainModule(moduleUrl: string): boolean {
  const entryPoint = process.argv[1];
  return (
    entryPoint !== undefined && moduleUrl === pathToFileURL(entryPoint).href
  );
}
