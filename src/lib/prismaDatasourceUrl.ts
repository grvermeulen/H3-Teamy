/**
 * Resolves the Postgres URL for Prisma at runtime.
 *
 * Next.js can inline static `process.env.PRISMA_DATABASE_URL` reads at build
 * time. On Vercel preview the Neon/Prisma marketplace injects a per-deploy
 * URL that may have a stale password, while the dashboard `PREVIEW_*` vars
 * still point at the shared preview database. Dynamic lookup + an explicit
 * preview preference keeps that overlay intact.
 */

function envVar(name: string): string | undefined {
  const value = process.env[name];
  return value?.trim() ? value : undefined;
}

/**
 * Datasource URL for the Prisma client: preview/development prefer `PREVIEW_*`
 * Neon vars; otherwise pooled `PRISMA_DATABASE_URL` then `DATABASE_URL`.
 *
 * @returns Trimmed connection string, or `undefined` when none is configured.
 */
export function resolvePrismaDatasourceUrl(): string | undefined {
  const vercelEnv = envVar("VERCEL_ENV");
  if (vercelEnv === "preview" || vercelEnv === "development") {
    return (
      envVar("PREVIEW_POSTGRES_PRISMA_URL") ||
      envVar("PREVIEW_DATABASE_URL") ||
      envVar("PREVIEW_POSTGRES_URL") ||
      envVar("PRISMA_DATABASE_URL") ||
      envVar("DATABASE_URL")
    );
  }
  return envVar("PRISMA_DATABASE_URL") || envVar("DATABASE_URL");
}
