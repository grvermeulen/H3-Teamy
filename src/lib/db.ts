import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

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
    // Direct PostgreSQL connection - use adapter for Prisma v7
    const pool = new Pool({ connectionString: url });
    const adapter = new PrismaPg(pool);
    return new PrismaClient({ adapter });
  })();

export const prisma = prismaInstance;
if (process.env.NODE_ENV !== "production") global.prisma = prismaInstance;
