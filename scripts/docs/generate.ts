import fs from "fs";
import path from "path";
import { execSync } from "child_process";

function injectSection(filePath: string, marker: string, content: string) {
  const start = `<!-- ${marker} -->`;
  const end = `<!-- /${marker} -->`;
  const src = fs.readFileSync(filePath, "utf8");
  const next = src.replace(
    new RegExp(`${start}[\\n\\r\\s\\S]*?${end}`),
    `${start}\n${content}\n${end}`,
  );
  fs.writeFileSync(filePath, next);
}

function main() {
  const root = process.cwd();

  // 0) ensure output dirs
  fs.mkdirSync(path.join(root, "docs/_generated"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs/api"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs/data"), { recursive: true });

  // 1) routes (ensure ts-node runs the TS scanner)
  execSync("npx ts-node scripts/docs/scan-routes.ts", { stdio: "inherit" });
  const routesMd = fs.readFileSync(
    path.join(root, "docs/_generated/routes.md"),
    "utf8",
  );
  injectSection(
    path.join(root, "docs/specs/functional.md"),
    "AUTOGEN:routes",
    routesMd,
  );

  // 2) features table (basic heuristic based on tech docs present)
  const techRoot = path.join(root, "docs/tech");
  const techDirs = fs.existsSync(techRoot)
    ? fs
        .readdirSync(techRoot)
        .filter((d) => fs.statSync(path.join(techRoot, d)).isDirectory())
    : [];
  const featureLines = ["| Feature | Docs |", "|---|---|"];
  for (const d of techDirs) {
    const readme = path.join(root, "docs/tech", d, "README.md");
    if (fs.existsSync(readme))
      featureLines.push(`| ${d} | docs/tech/${d}/README.md |`);
  }
  injectSection(
    path.join(root, "docs/specs/functional.md"),
    "AUTOGEN:features",
    featureLines.join("\n"),
  );

  // 3) openapi from zod
  execSync("npx ts-node scripts/docs/openapi.ts", { stdio: "inherit" });

  console.log("Docs generated.");
}

if (require.main === module) main();
