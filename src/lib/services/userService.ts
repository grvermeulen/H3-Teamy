import { User } from "@prisma/client";
import { prisma } from "../db";
import { kvGetJson, kvSetJson } from "../kv";
import { displayName } from "../userUtils";
import * as Sentry from "@sentry/nextjs";

type UserRow = Pick<User, "id" | "firstName" | "lastName" | "email">;
const DEFAULT_ACTIVE_USERS_MAX = 1000;

function getActiveUsersLimit(): number {
  const raw = Number(process.env.ACTIVE_USERS_MAX || DEFAULT_ACTIVE_USERS_MAX);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_ACTIVE_USERS_MAX;
  return Math.max(1, Math.min(Math.floor(raw), 5000));
}

/**
 * Retrieves the list of active users for the roster.
 *
 * @param refresh - If true, bypasses the cache and fetches fresh data from the DB.
 * @returns A promise resolving to a sorted list of users with IDs and display names.
 * @throws Will throw if the DB query fails.
 */
export async function getActiveUsers(refresh = false) {
  const cacheKey = "users:roster:v2";
  const maxUsers = getActiveUsersLimit();

  if (!refresh) {
    const cached = await kvGetJson<{ id: string; name: string }[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length) {
      return cached;
    }
  }

  let users: UserRow[] = [];
  try {
    users = await prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true, email: true },
      take: maxUsers,
      orderBy: { updatedAt: "desc" },
    });
  } catch (error: unknown) {
    Sentry.captureException(error);
    throw error;
  }

  const seen = new Set<string>();
  const list = [] as { id: string; name: string }[];

  for (const u of users) {
    const name = displayName(u);
    if (!name) continue; // skip users with no usable name
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // dedupe by display name
    seen.add(key);
    list.push({ id: u.id, name });
  }

  list.sort((a, b) => a.name.localeCompare(b.name));

  try {
    await kvSetJson(cacheKey, list);
  } catch (err) {
    console.error("Failed to update user cache:", err);
    Sentry.captureException(err);
  }

  return list;
}
