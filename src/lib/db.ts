import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const prismaInstance =
  global.prisma ||
  (process.env.DATABASE_URL
    ? new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } })
    : new PrismaClient());

export const prisma = prismaInstance;
if (process.env.NODE_ENV !== "production") global.prisma = prismaInstance;


