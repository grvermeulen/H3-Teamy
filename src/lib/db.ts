import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const basePrisma =
  global.prisma ||
  (() => {
    const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL;
    return url
      ? new PrismaClient({ datasources: { db: { url } } })
      : new PrismaClient();
  })();

// Add TTL/SWR caching for read queries via Prisma Postgres
function buildCachedClient(p: PrismaClient): PrismaClient {
  try {
    // @ts-ignore - $extends is available on PrismaClient
    const extended = p.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }: any) {
            const cacheEnabled = process.env.PRISMA_CACHE_ENABLED !== "0";
            const isRead = [
              "findUnique",
              "findMany",
              "findFirst",
              "count",
              "aggregate",
            ].includes(operation);
            if (!cacheEnabled || !isRead) return query(args);

            const rosterRead = model === "User" && operation === "findMany";
            const profileRead = model === "User" && operation === "findUnique";
            const ttl = rosterRead
              ? 300
              : profileRead
                ? 600
                : Number(process.env.CACHE_TTL || 60);
            const swr = rosterRead
              ? 60
              : profileRead
                ? 120
                : Number(process.env.CACHE_SWR || 0);
            return query({ ...args, cacheStrategy: { ttl, swr } });
          },
        },
      },
    });
    return extended as unknown as PrismaClient;
  } catch {
    return p;
  }
}

const prismaInstance = buildCachedClient(basePrisma);

export const prisma = prismaInstance;
if (process.env.NODE_ENV !== "production") global.prisma = prismaInstance;
