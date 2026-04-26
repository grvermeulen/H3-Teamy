// Side-effect import — required, see envBootstrap.ts. Without it Preview
// deploys read the production Redis/KV URLs instead of the per-deploy Upstash
// instance provisioned by the Neon/Upstash marketplace integrations.
import "./envBootstrap";
import * as Sentry from "@sentry/nextjs";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { withPgConnectRetry } from "./prismaConnectRetry";

type RsvpStatus = "yes" | "no" | "maybe" | null;
type UserProfile = {
  firstName: string;
  lastName: string;
  email?: string | null;
};
let prismaLoaded = false;
let prisma: PrismaClient | null = null;
async function getPrisma(): Promise<PrismaClient | null> {
  if (prismaLoaded) return prisma;
  if (!process.env.DATABASE_URL && !process.env.PRISMA_DATABASE_URL) {
    prismaLoaded = true;
    prisma = null;
    return null;
  }
  const mod = await import("./db");
  prisma = mod.prisma;
  prismaLoaded = true;
  return prisma;
}

// Simple in-memory fallback stores (not persistent across server restarts)
const memoryStore = new Map<string, RsvpStatus>();
const memoryJson = new Map<string, string>();
const memoryTtl = new Map<string, number>(); // unix ms expiration for local tokens

// Vercel KV compatibility if provided via env
// Expect standard env: KV_REST_API_URL, KV_REST_API_TOKEN, KV_REST_API_READ_ONLY_TOKEN, KV_URL
// Also supports Redis via REDIS_URL using ioredis
let redisClient: any = null;
async function getRedis() {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const { default: IORedis } = await import("ioredis");
  redisClient = new IORedis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
  try {
    await redisClient.connect?.();
  } catch {}
  return redisClient;
}
async function kvGet(key: string): Promise<RsvpStatus | null> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    const redis = await getRedis();
    if (redis) {
      const val = (await redis.get(key)) as RsvpStatus | null;
      if (val !== "yes" && val !== "no" && val !== "maybe") return null;
      return val;
    }
    return memoryStore.get(key) ?? null;
  }
  const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
    },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}) as any);
  const val = data?.result ?? null;
  if (val !== "yes" && val !== "no" && val !== "maybe") return null;
  return val;
}

async function kvSet(key: string, value: RsvpStatus): Promise<void> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    const redis = await getRedis();
    if (redis) {
      if (value === null) {
        await redis.del(key);
      } else {
        await redis.set(key, value);
      }
      return;
    }
    if (value === null) memoryStore.delete(key);
    else memoryStore.set(key, value);
    return;
  }
  const url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`;
  const body = new URLSearchParams();
  body.set("value", value ?? "");
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

export async function getRsvp(
  userId: string,
  eventId: string,
): Promise<RsvpStatus> {
  const p = await getPrisma();
  if (p) {
    const rec = await p.rsvp.findUnique({
      where: { userId_eventId: { userId, eventId } },
    });
    const val = (rec?.status as RsvpStatus) ?? null;
    if (val !== "yes" && val !== "no" && val !== "maybe") return null;
    return val;
  }
  const key = `rsvp:${userId}:${eventId}`;
  return kvGet(key);
}

/**
 * Stores or clears an RSVP for a calendar event when Prisma is available.
 * Ensures stub `Event` and `User` rows exist so FK constraints (`Rsvp_eventId_fkey`, user) are satisfied.
 *
 * @param userId - Authenticated user id.
 * @param eventId - Calendar event id (same string as in the UI / iCal-derived events).
 * @param status - RSVP value, or `null` to remove the row.
 */
export async function setRsvp(
  userId: string,
  eventId: string,
  status: RsvpStatus,
): Promise<void> {
  const p = await getPrisma();
  if (p) {
    if (status === null) {
      await p.rsvp
        .delete({ where: { userId_eventId: { userId, eventId } } })
        .catch((error: unknown) => {
          Sentry.captureException(error, {
            extra: { userId, eventId, context: "setRsvp_delete" },
          });
        });
    } else {
      await p.event.upsert({
        where: { id: eventId },
        create: { id: eventId },
        update: {},
      });
      await p.user.upsert({
        where: { id: userId },
        create: { id: userId, firstName: "", lastName: "" },
        update: {},
      });
      await p.rsvp.upsert({
        where: { userId_eventId: { userId, eventId } },
        create: { userId, eventId, status },
        update: { status },
      });
    }
    return;
  }
  const key = `rsvp:${userId}:${eventId}`;
  await kvSet(key, status);
}

// Generic JSON KV helpers for caching lists/objects
export async function kvGetJson<T = any>(key: string): Promise<T | null> {
  const redis = await getRedis();
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    if (redis) {
      const raw = (await redis.get(key)) as string | null;
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    }
    const exp = memoryTtl.get(key);
    if (typeof exp === "number" && Date.now() > exp) {
      memoryJson.delete(key);
      memoryTtl.delete(key);
      return null;
    }
    const raw = memoryJson.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}) as any);
  const raw = data?.result ?? null;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSetJson(key: string, value: any): Promise<void> {
  const redis = await getRedis();
  const payload = JSON.stringify(value);
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    if (redis) {
      await redis.set(key, payload);
      return;
    }
    memoryJson.set(key, payload);
    return;
  }
  const url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`;
  const body = new URLSearchParams();
  body.set("value", payload);
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

export async function kvDelete(key: string): Promise<void> {
  const redis = await getRedis();
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    if (redis) {
      await redis.del(key).catch(() => {});
      return;
    }
    memoryJson.delete(key);
    memoryTtl.delete(key);
    return;
  }
  const url = `${process.env.KV_REST_API_URL}/del/${encodeURIComponent(key)}`;
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  }).catch(() => {});
}

function makeToken(): string {
  // short code for dev; can switch to uuid if preferred
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

export async function createPasswordResetToken(
  email: string,
): Promise<{ ok: boolean; token?: string }> {
  const p = await getPrisma();
  const user = p ? await p.user.findFirst({ where: { email } }) : null;
  if (!user) return { ok: true }; // do not leak existence
  const token = makeToken();
  const key = `pwreset:${token}`;
  const redis = await getRedis();
  const ttlSec = 15 * 60;
  if (redis) {
    await redis.set(key, user.id, "EX", ttlSec);
  } else {
    memoryJson.set(key, JSON.stringify({ userId: user.id }));
    memoryTtl.set(key, Date.now() + ttlSec * 1000);
  }
  return { ok: true, token };
}

export async function redeemPasswordResetToken(
  token: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!token || !newPassword || newPassword.length < 8)
    return { ok: false, error: "invalid" };
  const key = `pwreset:${token}`;
  const redis = await getRedis();
  let userId: string | null = null;
  if (redis) {
    userId = (await redis.get(key)) as string | null;
  } else {
    const exp = memoryTtl.get(key);
    if (typeof exp === "number" && Date.now() > exp) {
      memoryJson.delete(key);
      memoryTtl.delete(key);
    }
    const val = memoryJson.get(key);
    if (val) {
      try {
        userId = JSON.parse(val).userId as string;
      } catch {
        userId = null;
      }
    }
  }
  if (!userId) return { ok: false, error: "invalid_or_expired" };
  const p = await getPrisma();
  if (!p) return { ok: false, error: "db_unavailable" };
  const hash = await bcrypt.hash(newPassword, 10);
  await p.user
    .update({ where: { id: userId }, data: { passwordHash: hash } })
    .catch(() => null);
  if (redis) {
    await redis.del(key).catch(() => {});
  } else {
    memoryJson.delete(key);
    memoryTtl.delete(key);
  }
  return { ok: true };
}

export async function setUserProfile(userId: string, profile: UserProfile) {
  const p = await getPrisma();
  if (p) {
    await p.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        firstName: profile.firstName,
        lastName: profile.lastName,
      },
      update: { firstName: profile.firstName, lastName: profile.lastName },
    });
    return;
  }
  const key = `user:${userId}`;
  const redis = await getRedis();
  if (redis) {
    await redis.hset(key, {
      firstName: profile.firstName,
      lastName: profile.lastName,
    });
    return;
  }
  memoryStore.set(key, JSON.stringify(profile) as any);
}

export async function getUserProfile(
  userId: string,
): Promise<UserProfile | null> {
  const p = await getPrisma();
  if (p) {
    const u = await p.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    });
    if (!u) return null;
    return {
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email ?? undefined,
    };
  }
  const key = `user:${userId}`;
  const redis = await getRedis();
  if (redis) {
    const res = await redis.hgetall(key);
    if (!res || (!res.firstName && !res.lastName)) return null;
    return { firstName: res.firstName || "", lastName: res.lastName || "" };
  }
  const raw = memoryStore.get(key) as unknown as string | undefined;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Retrieves profiles for multiple users in one batched lookup.
 *
 * @param userIds - User IDs to load profile information for.
 * @returns Mapping from user ID to profile fields for users that were found.
 */
export async function getUserProfiles(
  userIds: string[],
): Promise<Record<string, UserProfile>> {
  const out: Record<string, UserProfile> = {};
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return out;

  const p = await getPrisma();
  if (p) {
    return withPgConnectRetry("getUserProfiles", async () => {
      const rows = await p.user.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      const result: Record<string, UserProfile> = {};
      for (const row of rows) {
        result[row.id] = {
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email ?? undefined,
        };
      }
      return result;
    });
  }

  const redis = await getRedis();
  if (redis) {
    const entries = await Promise.all(
      uniqueIds.map(async (userId) => {
        const key = `user:${userId}`;
        const res = await redis.hgetall(key);
        if (!res || (!res.firstName && !res.lastName && !res.email))
          return null;
        return [
          userId,
          {
            firstName: res.firstName || "",
            lastName: res.lastName || "",
            email: res.email || undefined,
          } as UserProfile,
        ] as const;
      }),
    );
    for (const item of entries) {
      if (!item) continue;
      out[item[0]] = item[1];
    }
    return out;
  }

  for (const userId of uniqueIds) {
    const key = `user:${userId}`;
    const raw = memoryStore.get(key) as unknown as string | undefined;
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as UserProfile;
      out[userId] = parsed;
    } catch (error: unknown) {
      Sentry.captureException(error, {
        extra: { userId, context: "getUserProfiles_memory_parse" },
      });
    }
  }
  return out;
}

export async function listEventRsvps(
  eventId: string,
): Promise<{ userId: string; status: RsvpStatus }[]> {
  const p = await getPrisma();
  if (p) {
    return withPgConnectRetry("listEventRsvps", async () => {
      const rows = await p.rsvp.findMany({ where: { eventId } });
      return rows.map((r: { userId: string; status: unknown }) => ({
        userId: r.userId,
        status: (r.status as RsvpStatus) ?? null,
      }));
    });
  }
  const redis = await getRedis();
  if (redis) {
    const keys: string[] = await redis.keys(`rsvp:*:${eventId}`);
    if (keys.length === 0) return [];
    const vals = await redis.mget(keys);
    return keys.map((k, i) => ({
      userId: k.split(":")[1]!,
      status: (vals[i] as RsvpStatus) ?? null,
    }));
  }
  const out: { userId: string; status: RsvpStatus }[] = {} as any;
  const outArr: { userId: string; status: RsvpStatus }[] = [];
  for (const [k, v] of memoryStore.entries()) {
    if (
      typeof k === "string" &&
      k.startsWith(`rsvp:`) &&
      k.endsWith(`:${eventId}`)
    ) {
      const userId = k.split(":")[1] || "";
      const status = (v as RsvpStatus) ?? null;
      outArr.push({ userId, status });
    }
  }
  return outArr;
}

// NEW: List all RSVPs for a given user (used for attendance badge %)
export async function listUserRsvps(
  userId: string,
): Promise<{ eventId: string; status: RsvpStatus }[]> {
  const p = await getPrisma();
  if (p) {
    const rows = await p.rsvp.findMany({ where: { userId } });
    return rows.map((r: any) => ({
      eventId: r.eventId,
      status: (r.status as RsvpStatus) ?? null,
    }));
  }
  const redis = await getRedis();
  if (redis) {
    const keys: string[] = await redis.keys(`rsvp:${userId}:*`);
    if (keys.length === 0) return [];
    const vals = await redis.mget(keys);
    return keys.map((k, i) => ({
      eventId: k.split(":")[2]!,
      status: (vals[i] as RsvpStatus) ?? null,
    }));
  }
  const out: { eventId: string; status: RsvpStatus }[] = [];
  for (const [k, v] of memoryStore.entries()) {
    if (typeof k === "string" && k.startsWith(`rsvp:${userId}:`)) {
      const eventId = k.split(":")[2] || "";
      const status = (v as RsvpStatus) ?? null;
      out.push({ eventId, status });
    }
  }
  return out;
}

/**
 * Retrieves RSVP totals and yes-counts for multiple users.
 *
 * @param userIds - User IDs to aggregate RSVP stats for.
 * @returns Mapping from user ID to RSVP totals and yes counts.
 */
export async function getUserRsvpStats(
  userIds: string[],
): Promise<Record<string, { total: number; yes: number }>> {
  const out: Record<string, { total: number; yes: number }> = {};
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return out;

  const p = await getPrisma();
  if (p) {
    return withPgConnectRetry("getUserRsvpStats", async () => {
      const rows = await p.rsvp.findMany({
        where: { userId: { in: uniqueIds } },
        select: { userId: true, status: true },
      });
      const result: Record<string, { total: number; yes: number }> = {};
      for (const userId of uniqueIds) {
        result[userId] = { total: 0, yes: 0 };
      }
      for (const row of rows) {
        const current = result[row.userId] || { total: 0, yes: 0 };
        current.total += 1;
        if (row.status === "yes") current.yes += 1;
        result[row.userId] = current;
      }
      return result;
    });
  }

  for (const userId of uniqueIds) {
    const history = await listUserRsvps(userId).catch((error: unknown) => {
      Sentry.captureException(error, {
        extra: { userId, context: "getUserRsvpStats_listUserRsvps" },
      });
      return [];
    });
    out[userId] = {
      total: history.length,
      yes: history.filter((h) => h.status === "yes").length,
    };
  }
  return out;
}

// Match Reports
type MvpResult = {
  name: string;
  percent: number;
  votes: number;
  totalVotes: number;
  decidedAt: string;
};
type MatchReport = {
  content: string;
  createdAt: string;
  authorId?: string;
  mvpResult?: MvpResult;
};

export async function getReport(eventId: string): Promise<MatchReport | null> {
  const key = `report:${eventId}`;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    const redis = await getRedis();
    if (redis) {
      const raw = (await redis.get(key)) as string | null;
      if (!raw) return null;
      try {
        return JSON.parse(raw) as MatchReport;
      } catch {
        return null;
      }
    }
    const raw = memoryStore.get(key) as unknown as string | undefined;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as MatchReport;
    } catch {
      return null;
    }
  }
  const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
    },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}) as any);
  const raw = data?.result ?? null;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MatchReport;
  } catch {
    return null;
  }
}

export async function setReport(
  eventId: string,
  report: MatchReport | null,
): Promise<void> {
  const key = `report:${eventId}`;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    const redis = await getRedis();
    if (redis) {
      if (report === null) {
        await redis.del(key);
        return;
      }
      await redis.set(key, JSON.stringify(report));
      return;
    }
    if (report === null) memoryStore.delete(key);
    else memoryStore.set(key, JSON.stringify(report) as any);
    return;
  }
  const url = `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`;
  const body = new URLSearchParams();
  body.set("value", report ? JSON.stringify(report) : "");
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

// Training Attendance
export async function getAttendance(dateYmd: string): Promise<string[]> {
  const p = await getPrisma();
  if (p) {
    // Primary: Database
    const records = await p.attendance.findMany({
      where: { date: dateYmd },
      select: { userId: true },
    });
    if (records.length > 0) {
      return records.map((r: { userId: string }) => r.userId);
    }
    // Fallback: Redis/KV for backward compatibility
  }
  const key = `att:${dateYmd}`;
  const redis = await getRedis();
  if (redis) {
    const raw = (await redis.get(key)) as string | null;
    if (!raw) return [];
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }
  // Try memoryJson first (correct storage), fallback to memoryStore for backward compatibility
  const rawJson = memoryJson.get(key);
  if (rawJson) {
    try {
      return JSON.parse(rawJson) as string[];
    } catch {
      return [];
    }
  }
  const raw = memoryStore.get(key) as unknown as string | undefined;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as string[];
    // Migrate to memoryJson for future reads
    memoryJson.set(key, raw);
    return parsed;
  } catch {
    return [];
  }
}

export async function setAttendanceBatch(
  dateYmd: string,
  presentUserIds: string[],
  markedBy: string,
): Promise<void> {
  const p = await getPrisma();
  if (p) {
    // Primary: Database
    // Delete existing attendance for this date
    try {
      await p.attendance.deleteMany({ where: { date: dateYmd } });
    } catch (error: unknown) {
      Sentry.captureException(error, {
        extra: { dateYmd, context: "setAttendanceBatch_deleteMany" },
      });
      throw error;
    }
    // Insert new attendance records
    if (presentUserIds.length > 0) {
      // Ensure users exist (satisfy FK constraint) with batched queries.
      const userIds = Array.from(new Set(presentUserIds.filter(Boolean)));
      if (userIds.length > 0) {
        const existing = await p.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true },
        });
        const existingIds = new Set(existing.map((u) => u.id));
        const missingIds = userIds.filter((userId) => !existingIds.has(userId));
        if (missingIds.length > 0) {
          try {
            await p.user.createMany({
              data: missingIds.map((id) => ({
                id,
                firstName: "",
                lastName: "",
              })),
              skipDuplicates: true,
            });
          } catch (error: unknown) {
            Sentry.captureException(error, {
              extra: {
                missingIds,
                context: "setAttendanceBatch_createMany",
              },
            });
            for (const userId of missingIds) {
              try {
                await p.user.upsert({
                  where: { id: userId },
                  create: { id: userId, firstName: "", lastName: "" },
                  update: {},
                });
              } catch (upsertError: unknown) {
                Sentry.captureException(upsertError, {
                  extra: {
                    userId,
                    context: "setAttendanceBatch_upsertFallback",
                  },
                });
                throw upsertError;
              }
            }
          }
        }
      }
      // Insert attendance records
      await p.attendance.createMany({
        data: presentUserIds.map((userId) => ({
          date: dateYmd,
          userId,
          markedBy,
        })),
        skipDuplicates: true,
      });
    }
    // Also update Redis/KV for backward compatibility
  }
  const key = `att:${dateYmd}`;
  const redis = await getRedis();
  const payload = JSON.stringify(presentUserIds);
  if (redis) {
    await redis.set(key, payload);
    return;
  }
  // Store in memoryJson (correct storage) and also in memoryStore for backward compatibility
  memoryJson.set(key, payload);
  memoryStore.set(key, payload as any);
}

export async function getAttendanceForDates(
  dates: string[],
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (dates.length === 0) return out;

  const p = await getPrisma();
  if (p) {
    // Primary: Database
    const records = await p.attendance.findMany({
      where: { date: { in: dates } },
      select: { date: true, userId: true },
    });
    // Group by date
    for (const d of dates) {
      out[d] = [];
    }
    for (const record of records) {
      if (!out[record.date]) out[record.date] = [];
      out[record.date].push(record.userId);
    }
    // Don't use Redis/KV fallback when database is available
    // This prevents old Redis data from adding extra sessions
    // Database is now the source of truth for attendance
    return out;
  }

  // Fallback: Redis/KV only
  const redis = await getRedis();
  if (redis) {
    const keys = dates.map((d) => `att:${d}`);
    const vals = await redis.mget(keys);
    for (let i = 0; i < dates.length; i++) {
      const raw = vals[i] as string | null;
      if (!raw) {
        out[dates[i]] = [];
        continue;
      }
      try {
        out[dates[i]] = JSON.parse(raw) as string[];
      } catch {
        out[dates[i]] = [];
      }
    }
    return out;
  }
  for (const d of dates) {
    const key = `att:${d}`;
    const rawJson = memoryJson.get(key);
    if (rawJson) {
      try {
        out[d] = JSON.parse(rawJson) as string[];
      } catch {
        out[d] = [];
      }
      continue;
    }
    const raw = memoryStore.get(key) as unknown as string | undefined;
    if (!raw) {
      out[d] = [];
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as string[];
      memoryJson.set(key, raw);
      out[d] = parsed;
    } catch {
      out[d] = [];
    }
  }
  return out;
}

// Helper to list all attendance keys (for debugging/migration)
export async function listAllAttendanceKeys(): Promise<string[]> {
  const redis = await getRedis();
  if (redis) {
    const keys: string[] = await redis.keys("att:*");
    return keys.map((k) => k.replace("att:", ""));
  }
  const keys: string[] = [];
  // Check memoryJson
  for (const k of memoryJson.keys()) {
    if (k.startsWith("att:")) keys.push(k.replace("att:", ""));
  }
  // Check memoryStore (backward compatibility)
  for (const k of memoryStore.keys()) {
    if (
      typeof k === "string" &&
      k.startsWith("att:") &&
      !keys.includes(k.replace("att:", ""))
    ) {
      keys.push(k.replace("att:", ""));
    }
  }
  return keys.sort();
}

// Roles (admin/trainer/player) stored in KV/Redis for simplicity
export type UserRoles = {
  admin?: boolean;
  trainer?: boolean;
  player?: boolean;
};
type Roles = UserRoles;

export async function getUserRoles(userId: string): Promise<Roles> {
  const key = `roles:${userId}`;
  const redis = await getRedis();
  if (redis) {
    const raw = (await redis.get(key)) as string | null;
    if (!raw) return { player: true };
    try {
      return JSON.parse(raw) as Roles;
    } catch {
      return { player: true };
    }
  }
  const raw = memoryStore.get(key) as unknown as string | undefined;
  if (!raw) return { player: true };
  try {
    return JSON.parse(raw) as Roles;
  } catch {
    return { player: true };
  }
}

/**
 * Retrieves role assignments for multiple users in one batched lookup.
 *
 * @param userIds - User IDs to load roles for.
 * @returns Mapping from user ID to role flags with default player role for missing entries.
 */
export async function getUserRolesBatch(
  userIds: string[],
): Promise<Record<string, Roles>> {
  const out: Record<string, Roles> = {};
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return out;

  const redis = await getRedis();
  if (redis) {
    const keys = uniqueIds.map((id) => `roles:${id}`);
    const vals = (await redis.mget(keys)) as Array<string | null>;
    for (let i = 0; i < uniqueIds.length; i++) {
      const raw = vals[i];
      if (!raw) {
        out[uniqueIds[i]] = { player: true };
        continue;
      }
      try {
        out[uniqueIds[i]] = JSON.parse(raw) as Roles;
      } catch (err: unknown) {
        Sentry.captureException(err, {
          extra: {
            userId: uniqueIds[i],
            context: "getUserRolesBatch_redis_parse",
          },
        });
        out[uniqueIds[i]] = { player: true };
      }
    }
    return out;
  }

  for (const userId of uniqueIds) {
    const raw = memoryStore.get(`roles:${userId}`) as unknown as
      | string
      | undefined;
    if (!raw) {
      out[userId] = { player: true };
      continue;
    }
    try {
      out[userId] = JSON.parse(raw) as Roles;
    } catch (err: unknown) {
      Sentry.captureException(err, {
        extra: { userId, context: "getUserRolesBatch_memory_parse" },
      });
      out[userId] = { player: true };
    }
  }
  return out;
}

export async function setUserRoles(
  userId: string,
  roles: Roles,
): Promise<void> {
  const key = `roles:${userId}`;
  const payload = JSON.stringify(roles);
  const redis = await getRedis();
  if (redis) {
    await redis.set(key, payload);
    return;
  }
  memoryStore.set(key, payload as any);
}

export async function createLinkCode(userId: string): Promise<string> {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const key = `link:${code}`;
  const redis = await getRedis();
  if (redis) {
    await redis.set(key, userId, "EX", 10 * 60); // 10 minutes TTL
  } else {
    memoryStore.set(key, userId as any);
    setTimeout(() => memoryStore.delete(key), 10 * 60 * 1000);
  }
  return code;
}

export async function redeemLinkCode(code: string): Promise<string | null> {
  const key = `link:${code}`;
  const redis = await getRedis();
  if (redis) {
    const userId = (await redis.get(key)) as string | null;
    if (!userId) return null;
    await redis.del(key);
    return userId;
  }
  const userId = (memoryStore.get(key) as unknown as string) || null;
  if (!userId) return null;
  memoryStore.delete(key);
  return userId;
}
