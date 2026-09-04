import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getActiveUser } from "./activeUser";
import { isDbUnavailableError } from "./dbUnavailableError";
import { prisma } from "./db";
import { getUserRoles, type UserRoles } from "./kv";
import {
  isTransientPostgresConnectError,
  withPgConnectRetry,
} from "./prismaConnectRetry";
import {
  getBootstrapAdminUserIds,
  getBootstrapTrainerUserIds,
} from "./roleEnv";
import { USER_CORE_SELECT } from "./userPrismaSelect";
import { displayName } from "./userUtils";

/**
 * Checks if the current request is from a Trainer or Admin.
 * Verifies against env bootstrap user IDs (`ADMIN_USER_IDS`, `TRAINER_USER_IDS`)
 * and KV roles keyed by user ID.
 *
 * @param req - The incoming Next.js request.
 * @returns An object containing `isTrainer` boolean and the user's identity `me`.
 *   When user resolution fails (e.g. database connection timeout), returns `isTrainer: false`
 *   and an empty `me`. Tijdelijke DB-connectiefouten worden niet dubbel naar Sentry gestuurd
 *   (retry + één geaggregeerde melding bij uitputting).
 */
export async function isTrainer(
  req: NextRequest,
): Promise<{ isTrainer: boolean; me: { id: string; name: string } }> {
  let userId: string;
  try {
    ({ userId } = await getActiveUser(req));
  } catch (err: unknown) {
    if (!isDbUnavailableError(err) && !isTransientPostgresConnectError(err)) {
      Sentry.captureException(err, {
        tags: { component: "trainer" },
        extra: { context: "getActiveUser_isTrainer" },
      });
    }
    return { isTrainer: false, me: { id: "", name: "" } };
  }
  try {
    const user = await withPgConnectRetry("isTrainer_loadUser", () =>
      prisma.user.findUnique({
        where: { id: userId },
        select: USER_CORE_SELECT,
      }),
    );
    const full = displayName(user ?? {});
    const envAdmin = getBootstrapAdminUserIds().has(userId);
    const envTrainer = getBootstrapTrainerUserIds().has(userId) || envAdmin;
    const roles: UserRoles = await getUserRoles(userId).catch(
      (err: unknown) => {
        Sentry.captureException(err, {
          tags: { component: "trainer" },
          extra: { context: "getUserRoles_isTrainer", userId },
        });
        return { player: true };
      },
    );
    const byRole = Boolean(roles?.trainer || roles?.admin);
    return {
      isTrainer: Boolean(envAdmin || envTrainer || byRole),
      me: { id: userId, name: full },
    };
  } catch (err: unknown) {
    if (!isDbUnavailableError(err) && !isTransientPostgresConnectError(err)) {
      Sentry.captureException(err, {
        tags: { component: "trainer" },
        extra: { context: "isTrainer", userId },
      });
    }
    return { isTrainer: false, me: { id: userId, name: "" } };
  }
}

/**
 * Checks if the current request is from an Admin.
 * Verifies against env bootstrap user IDs (`ADMIN_USER_IDS`) and KV roles.
 *
 * @param req - The incoming Next.js request.
 * @returns An object containing `isAdmin` boolean and the user's identity `me`.
 *   When user resolution fails (e.g. database connection timeout), returns `isAdmin: false`
 *   and an empty `me`. Tijdelijke DB-connectiefouten worden niet dubbel naar Sentry gestuurd.
 */
export async function isAdminUser(
  req: NextRequest,
): Promise<{ isAdmin: boolean; me: { id: string; name: string } }> {
  let userId: string;
  try {
    ({ userId } = await getActiveUser(req));
  } catch (err: unknown) {
    if (!isDbUnavailableError(err) && !isTransientPostgresConnectError(err)) {
      Sentry.captureException(err, {
        tags: { component: "trainer" },
        extra: { context: "getActiveUser_isAdminUser" },
      });
    }
    return { isAdmin: false, me: { id: "", name: "" } };
  }
  try {
    const user = await withPgConnectRetry("isAdminUser_loadUser", () =>
      prisma.user.findUnique({
        where: { id: userId },
        select: USER_CORE_SELECT,
      }),
    );
    const full = displayName(user ?? {});
    const envAdmin = getBootstrapAdminUserIds().has(userId);
    const roles: UserRoles = await getUserRoles(userId).catch(
      (err: unknown) => {
        Sentry.captureException(err, {
          tags: { component: "trainer" },
          extra: { context: "getUserRoles_isAdminUser", userId },
        });
        return { player: true };
      },
    );
    const byRole = Boolean(roles?.admin);
    return {
      isAdmin: Boolean(envAdmin || byRole),
      me: { id: userId, name: full },
    };
  } catch (err: unknown) {
    if (!isDbUnavailableError(err) && !isTransientPostgresConnectError(err)) {
      Sentry.captureException(err, {
        tags: { component: "trainer" },
        extra: { context: "isAdminUser", userId },
      });
    }
    return { isAdmin: false, me: { id: userId, name: "" } };
  }
}
