import type { Prisma } from "@prisma/client";

/**
 * Columns to read from `User` in hot paths. Keeps generated SQL aligned with
 * databases that may lag behind the Prisma schema (e.g. preview without latest
 * migrations), avoiding `SELECT *` / implicit full-model reads.
 */
export const USER_CORE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  passwordHash: true,
} satisfies Prisma.UserSelect;

export type UserCoreRow = Prisma.UserGetPayload<{
  select: typeof USER_CORE_SELECT;
}>;
