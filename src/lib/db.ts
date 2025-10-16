import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const prismaInstance =
  global.prisma ||
  (() => {
    const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL;
    return url ? new PrismaClient({ datasources: { db: { url } } }) : new PrismaClient();
  })();

export const prisma = prismaInstance;
if (process.env.NODE_ENV !== "production") global.prisma = prismaInstance;


