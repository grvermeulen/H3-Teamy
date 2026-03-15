import { Prisma, PrismaClient } from "@prisma/client";
import { recordPrismaQuery, isDbMetricsEnabled } from "./dbMetrics";

declare global {
  var prisma: PrismaClient | undefined;
  var prismaQueryMetricsAttached: boolean | undefined;
}

const prismaInstance =
  global.prisma ||
  (() => {
    const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL;
    const baseOptions: Prisma.PrismaClientOptions = isDbMetricsEnabled()
      ? { log: [{ emit: "event", level: "query" as const }] }
      : {};
    return url
      ? new PrismaClient({ ...baseOptions, datasources: { db: { url } } })
      : new PrismaClient(baseOptions);
  })();

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
