import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const prismaInstance =
  global.prisma ||
  (() => {
    const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL;
    if (!url) {
      return new PrismaClient();
    }
    // Prisma Accelerate URL (prisma://...)
    if (url.startsWith("prisma://")) {
      return new PrismaClient({ accelerateUrl: url });
    }
    // Direct PostgreSQL connection - Prisma 7 reads DATABASE_URL from env automatically
    // But we can also use adapter for explicit control if needed
    return new PrismaClient();
  })();

export const prisma = prismaInstance;
if (process.env.NODE_ENV !== "production") global.prisma = prismaInstance;


