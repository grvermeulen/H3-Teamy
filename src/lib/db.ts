// Side-effect: rewrites PREVIEW_* env vars onto their canonical names so this
// file (and kv.ts) can read DATABASE_URL/REDIS_URL/etc. uniformly across envs.
// Don't remove — the Prisma Postgres marketplace integration silently injects
// production's DATABASE_URL into Preview deploys; the bootstrap overlays Neon's
// per-deploy values back on top so previews stay isolated. See envBootstrap.ts.
import "./envBootstrap";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { recordPrismaQuery, isDbMetricsEnabled } from "./dbMetrics";
import { getPgPoolConfig, getPrismaPgAdapterOptions } from "./pgPool";

declare global {
  var prisma: PrismaClient | undefined;
  var prismaQueryMetricsAttached: boolean | undefined;
}

/**
 * Removes `channel_binding=require` from the connection string.
 *
 * Some PostgreSQL connection-string consumers — including the version of `pg`
 * we ship — don't negotiate SCRAM-SHA-256-PLUS against PgBouncer reliably on
 * Node 22. The same URL works against the direct compute endpoint and on
 * Node 24. Stripping the parameter falls back to plain SCRAM-SHA-256, which
 * still uses TLS via `sslmode=require`.
 */
function relaxChannelBinding(url: string): string {
  if (!url.includes("channel_binding=")) return url;
  return url
    .replace(/[?&]channel_binding=[^&]*/, (m) => (m.startsWith("?") ? "?" : ""))
    .replace(/\?&/, "?")
    .replace(/\?$/, "");
}

const prismaInstance =
  global.prisma ||
  (() => {
    const rawUrl =
      process.env.PRISMA_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
    const url = relaxChannelBinding(rawUrl);
    const baseOptions: Prisma.PrismaClientOptions = isDbMetricsEnabled()
      ? { log: [{ emit: "event", level: "query" as const }] }
      : {};
    const adapter = new PrismaPg(
      getPgPoolConfig(url) as ConstructorParameters<typeof PrismaPg>[0],
      getPrismaPgAdapterOptions(),
    );
    return new PrismaClient({ ...baseOptions, adapter });
  })();

/** Gedeelde Prisma-client (Prisma 7 met `pg`-adapter wanneer `DATABASE_URL` gezet is). */
export const prisma = prismaInstance;
if (isDbMetricsEnabled() && !global.prismaQueryMetricsAttached) {
  // Global listener captures Prisma query events and attributes them to request context.
  prisma.$on("query" as never, (event: Prisma.QueryEvent) => {
    const duration = typeof event.duration === "number" ? event.duration : 0;
    const query = typeof event.query === "string" ? event.query : "";
    recordPrismaQuery(duration, query);
  });
  global.prismaQueryMetricsAttached = true;
}
if (process.env.NODE_ENV !== "production") global.prisma = prismaInstance;
