import { Prisma } from "@prisma/client";

/**
 * Minimale Prisma-`select` voor trainer/admin checks (naam uit DB vs. env).
 * Voorkomt impliciete `SELECT *` wanneer het `User`-model uitbreidt — minder kans op schema drift met de database.
 */
export const userAuthSnapshotSelect = {
  id: true,
  firstName: true,
  lastName: true,
} satisfies Prisma.UserSelect;

/** Rijvorm die hoort bij {@link userAuthSnapshotSelect}. */
export type UserAuthSnapshot = Prisma.UserGetPayload<{
  select: typeof userAuthSnapshotSelect;
}>;
