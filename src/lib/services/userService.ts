import { User } from "@prisma/client";
import { prisma } from "../db";
import { kvGetJson, kvSetJson } from "../kv";
import { displayName } from "../userUtils";
import * as Sentry from "@sentry/nextjs";

type UserRow = Pick<User, "id" | "firstName" | "lastName" | "email">;

/**
 * Retrieves the list of active users for the roster.
 *
 * @param refresh - If true, bypasses the cache and fetches fresh data from the DB.
 * @returns A promise resolving to a sorted list of users with IDs and display names.
 * @throws Will throw if the DB query fails.
 */
export async function getActiveUsers(refresh = false) {
  const cacheKey = "users:roster:v2";

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
  await kvSetJson(cacheKey, list);

  return list;
}
