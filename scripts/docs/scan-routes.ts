import fs from "fs";
import path from "path";

function walk(
  dir: string,
  filter: (p: string) => boolean,
  acc: string[] = [],
): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, filter, acc);
    else if (filter(full)) acc.push(full);
  }
  return acc;
}

function toRoute(filePath: string): string {
  // src/app/api/foo/bar/route.ts -> /api/foo/bar
  const rel = filePath.split("src/app").pop() || "";
  return rel.replace(/\\/g, "/").replace(/\/route\.[tj]s$/, "");
}

function toPage(filePath: string): string {
  // src/app/foo/bar/page.tsx -> /foo/bar
  const rel = filePath.split("src/app").pop() || "";
  return rel.replace(/\\/g, "/").replace(/\/page\.[tj]sx?$/, "");
}

function main() {
  const root = process.cwd();
  const apiFiles = walk(path.join(root, "src/app"), (p) =>
    /\/api\/.+\/route\.[tj]s$/.test(p),
  );
  const pageFiles = walk(path.join(root, "src/app"), (p) =>
    /\/page\.[tj]sx?$/.test(p),
  );

  const apiRoutes = apiFiles.map((f) => toRoute(f));
  const pages = pageFiles.map((f) => toPage(f));

  const outDir = path.join(root, "docs/_generated");
  fs.mkdirSync(outDir, { recursive: true });
  const lines: string[] = [];
  lines.push("# Routes Inventory\n");
  lines.push("## API Routes\n");
  for (const r of apiRoutes.sort()) lines.push(`- ${r}`);
  lines.push("\n## Pages\n");
  for (const r of pages.sort()) lines.push(`- ${r}`);
  fs.writeFileSync(path.join(outDir, "routes.md"), lines.join("\n"));
  console.log("Wrote docs/_generated/routes.md");
}

if (require.main === module) main();
