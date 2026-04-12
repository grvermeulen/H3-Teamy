import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { recordPrismaQuery, isDbMetricsEnabled } from "./dbMetrics";
import { getPgPoolConfig, getPrismaPgAdapterOptions } from "./pgPool";

declare global {
  var prisma: PrismaClient | undefined;
  var prismaQueryMetricsAttached: boolean | undefined;
}

const prismaInstance =
  global.prisma ||
  (() => {
    const url =
      process.env.PRISMA_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
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
