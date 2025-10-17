import fs from "fs";
import path from "path";

export const dynamic = "force-static";

async function readFileSafe(p: string): Promise<string | null> {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (_e) {
    return null;
  }
}

export default async function DocsPage() {
  const root = process.cwd();
  const functionalPath = path.join(root, "docs/specs/functional.md");
  const routesPath = path.join(root, "docs/_generated/routes.md");
  const openapiPath = path.join(root, "docs/api/openapi.json");
  const erdPath = path.join(root, "docs/data/model.svg");

  const [functional, routes, openapi, erdSvg] = await Promise.all([
    readFileSafe(functionalPath),
    readFileSafe(routesPath),
    readFileSafe(openapiPath),
    readFileSafe(erdPath),
  ]);

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <h1>Documentation</h1>

      <section style={{ marginTop: 24 }}>
        <h2>Functional Spec</h2>
        <div className="card" style={{ padding: 12 }}>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {functional ||
              "docs/specs/functional.md not found or not generated yet."}
          </pre>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Routes Inventory</h2>
        <div className="card" style={{ padding: 12 }}>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {routes ||
              "docs/_generated/routes.md not found. Run npm run docs:generate."}
          </pre>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>OpenAPI (JSON)</h2>
        <div className="card" style={{ padding: 12 }}>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {openapi ||
              "docs/api/openapi.json not found. Run npm run docs:generate."}
          </pre>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Data Model (ERD)</h2>
        <div className="card" style={{ padding: 12 }}>
          {erdSvg ? (
            <div dangerouslySetInnerHTML={{ __html: erdSvg }} />
          ) : (
            <div className="muted">
              docs/data/model.svg not found. Run npx prisma generate.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
