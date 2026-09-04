// Side-effect import — required, see envBootstrap.ts. Without it Preview
// deploys read the production Redis/KV URLs instead of the per-deploy Upstash
// instance provisioned by the Neon/Upstash marketplace integrations.
import "./envBootstrap";
import * as Sentry from "@sentry/nextjs";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { withPgConnectRetry, shouldFallbackFromPrismaToKv } from "./prismaConnectRetry";
import {
  PASSWORD_RESET_TTL_SEC,
  normalizePasswordResetToken,
  passwordResetPendingKey,
  passwordResetRedisKey,
} from "./passwordResetToken";

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
let redisDisabled = false;
/** Separate Redis client for auth tokens — not disabled by RSVP/cache errors elsewhere. */
let authRedisClient: any = null;

function markRedisUnavailable(): void {
  redisDisabled = true;
  if (redisClient) {
    try {
      redisClient.disconnect?.();
    } catch {}
    redisClient = null;
  }
}

function captureKvCacheError(error: unknown, operation: string): void {
  Sentry.captureException(
    error instanceof Error ? error : new Error(String(error)),
    {
      tags: { component: "kv-cache", operation },
    },
  );
}

async function getRedis() {
  if (redisDisabled) return null;
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { default: IORedis } = await import("ioredis");
    redisClient = new IORedis(url, redisClientOptions(url));
    await redisClient.connect?.();
    return redisClient;
  } catch (error: unknown) {
    captureKvCacheError(error, "redis_connect");
    markRedisUnavailable();
    return null;
  }
}

function redisClientOptions(url: string) {
  const options: Record<string, unknown> = {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: false,
    connectTimeout: 10000,
  };
  if (url.startsWith("rediss://")) {
    options.tls = {};
  }
  return options;
}

/** Redis for password-reset and other auth KV — isolated from {@link markRedisUnavailable}. */
async function getAuthRedis() {
  if (authRedisClient) return authRedisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { default: IORedis } = await import("ioredis");
    authRedisClient = new IORedis(url, redisClientOptions(url));
    await authRedisClient.connect?.();
    return authRedisClient;
  } catch (error: unknown) {
    captureKvCacheError(error, "auth_redis_connect");
    authRedisClient = null;
    return null;
  }
}
async function kvGet(key: string): Promise<RsvpStatus | null> {
  const redis = await getRedis();
  if (redis) {
    try {
      const val = (await redis.get(key)) as RsvpStatus | null;
      if (val !== "yes" && val !== "no" && val !== "maybe") return null;
      return val;
    } catch (error: unknown) {
      captureKvCacheError(error, "kvGet_redis");
      markRedisUnavailable();
    }
  }
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
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
    } catch (error: unknown) {
      captureKvCacheError(error, "kvGet_rest");
      return memoryStore.get(key) ?? null;
    }
  }
  return memoryStore.get(key) ?? null;
}

async function kvSet(key: string, value: RsvpStatus): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      if (value === null) {
        await redis.del(key);
      } else {
        await redis.set(key, value);
      }
      return;
    } catch (error: unknown) {
      captureKvCacheError(error, "kvSet_redis");
      markRedisUnavailable();
    }
  }
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      await fetch(
        `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          },
          body: value ?? "",
        },
      );
      return;
    } catch (error: unknown) {
      captureKvCacheError(error, "kvSet_rest");
    }
  }
  if (value === null) memoryStore.delete(key);
  else memoryStore.set(key, value);
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
  if (redis) {
    try {
      const raw = (await redis.get(key)) as string | null;
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    } catch (error: unknown) {
      captureKvCacheError(error, "kvGetJson_redis");
      markRedisUnavailable();
    }
  }
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
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
    } catch (error: unknown) {
      captureKvCacheError(error, "kvGetJson_rest");
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

export async function kvSetJson(key: string, value: any): Promise<void> {
  const redis = await getRedis();
  const payload = JSON.stringify(value);
  if (redis) {
    try {
      await redis.set(key, payload);
      return;
    } catch (error: unknown) {
      captureKvCacheError(error, "kvSetJson_redis");
      markRedisUnavailable();
    }
  }
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      await fetch(
        `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          },
          body: payload,
        },
      );
      return;
    } catch (error: unknown) {
      captureKvCacheError(error, "kvSetJson_rest");
    }
  }
  memoryJson.set(key, payload);
}

export async function kvDelete(key: string): Promise<void> {
  const redis = (await getAuthRedis()) ?? (await getRedis());
  if (redis) {
    try {
      await redis.del(key);
      return;
    } catch (error: unknown) {
      captureKvCacheError(error, "kvDelete_redis");
      if (redis === redisClient) markRedisUnavailable();
    }
  }
  const restDel = await kvRestCommand(["DEL", key]);
  if (restDel !== null) return;
  const restBase = kvRestBaseUrl();
  const token = kvRestToken();
  if (restBase && token) {
    await fetch(`${restBase}/del/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }).catch((error: unknown) => {
      captureKvCacheError(error, "kvDelete_rest");
    });
    return;
  }
  memoryJson.delete(key);
  memoryTtl.delete(key);
}

function kvRestBaseUrl(): string | null {
  const candidates = [
    process.env.KV_REST_API_URL,
    process.env.UPSTASH_REDIS_REST_URL,
    process.env.KV_URL?.startsWith("http") ? process.env.KV_URL : null,
  ];
  for (const url of candidates) {
    if (url) return url.replace(/\/$/, "");
  }
  return null;
}

function kvRestToken(): string | null {
  return (
    process.env.KV_REST_API_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    null
  );
}

async function kvRestCommand(command: string[]): Promise<string | null> {
  const restBase = kvRestBaseUrl();
  const token = kvRestToken();
  if (!restBase || !token) return null;
  try {
    const res = await fetch(restBase, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      result?: string | null;
    } | null;
    const result = data?.result;
    return typeof result === "string" ? result : null;
  } catch (error: unknown) {
    captureKvCacheError(error, "kvRestCommand");
    return null;
  }
}

/** Redis-first string storage with TTL; falls back to KV REST then in-memory. */
async function kvSetStringWithTtl(
  key: string,
  value: string,
  ttlSec: number,
): Promise<boolean> {
  const redis = await getAuthRedis();
  if (redis) {
    try {
      await redis.set(key, value, "EX", ttlSec);
      return true;
    } catch (error: unknown) {
      captureKvCacheError(error, "kvSetStringWithTtl_redis");
    }
  }
  const restSet = await kvRestCommand([
    "SET",
    key,
    value,
    "EX",
    String(ttlSec),
  ]);
  if (restSet === "OK") return true;
  const restBase = kvRestBaseUrl();
  const token = kvRestToken();
  if (restBase && token) {
    try {
      const res = await fetch(
        `${restBase}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${ttlSec}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        },
      );
      if (res.ok) return true;
    } catch (error: unknown) {
      captureKvCacheError(error, "kvSetStringWithTtl_rest");
    }
  }
  memoryJson.set(key, value);
  memoryTtl.set(key, Date.now() + ttlSec * 1000);
  return process.env.NODE_ENV !== "production";
}

/** Redis-first string lookup; falls back to KV REST then in-memory TTL map. */
async function kvGetString(key: string): Promise<string | null> {
  const redis = await getAuthRedis();
  if (redis) {
    try {
      const val = (await redis.get(key)) as string | null;
      return val ?? null;
    } catch (error: unknown) {
      captureKvCacheError(error, "kvGetString_redis");
    }
  }
  const restVal = await kvRestCommand(["GET", key]);
  if (restVal) return restVal;
  const restBase = kvRestBaseUrl();
  const token = kvRestToken();
  if (restBase && token) {
    try {
      const res = await fetch(`${restBase}/get/${encodeURIComponent(key)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = await res
        .json()
        .catch(() => ({}) as { result?: string | null });
      const val = data?.result;
      return typeof val === "string" ? val : null;
    } catch (error: unknown) {
      captureKvCacheError(error, "kvGetString_rest");
    }
  }
  if (process.env.NODE_ENV === "production") return null;
  const exp = memoryTtl.get(key);
  if (typeof exp === "number" && Date.now() > exp) {
    memoryJson.delete(key);
    memoryTtl.delete(key);
    return null;
  }
  return memoryJson.get(key) ?? null;
}

const WEBAUTHN_CHALLENGE_TTL_SEC = 5 * 60;

/**
 * Bewaar een tijdelijke WebAuthn-challenge (registratie of login), Redis-first met TTL.
 * Bij ontbrekende Redis: geheugenfallback met expiry (zoals wachtwoord-reset tokens).
 *
 * @param kind - Registratie onder ingelogde gebruiker of anonieme authenticatie-flow.
 * @param sessionKey - Unieke sleutel (`userId` bij registratie, willekeurige sessie-id bij login).
 * @param challenge - Base64url challenge-string uit SimpleWebAuthn.
 */
export async function webAuthnStoreChallenge(
  kind: "registration" | "authentication",
  sessionKey: string,
  challenge: string,
): Promise<void> {
  const key = `webauthn:${kind}:${sessionKey}`;
  const redis = await getRedis();
  if (redis) {
    await redis.set(key, challenge, "EX", WEBAUTHN_CHALLENGE_TTL_SEC);
    return;
  }
  memoryJson.set(key, JSON.stringify({ challenge }));
  memoryTtl.set(key, Date.now() + WEBAUTHN_CHALLENGE_TTL_SEC * 1000);
}

/**
 * Haalt een challenge op en verwijdert deze (eenmalig gebruik).
 *
 * @param kind - Zelfde scope als bij {@link webAuthnStoreChallenge}.
 * @param sessionKey - Zelfde sleutel als bij opslag.
 * @returns De challenge-string of `null` bij ontbreken of expiry.
 */
export async function webAuthnConsumeChallenge(
  kind: "registration" | "authentication",
  sessionKey: string,
): Promise<string | null> {
  const key = `webauthn:${kind}:${sessionKey}`;
  const redis = await getRedis();
  if (redis) {
    const pipeline = redis.pipeline();
    pipeline.get(key);
    pipeline.del(key);
    const results = await pipeline.exec();
    const raw = results?.[0]?.[1];
    return typeof raw === "string" ? raw : null;
  }
  const exp = memoryTtl.get(key);
  if (typeof exp === "number" && Date.now() > exp) {
    memoryJson.delete(key);
    memoryTtl.delete(key);
    return null;
  }
  const val = memoryJson.get(key);
  memoryJson.delete(key);
  memoryTtl.delete(key);
  if (!val) return null;
  try {
    const parsed = JSON.parse(val) as { challenge?: string };
    return typeof parsed.challenge === "string" ? parsed.challenge : null;
  } catch {
    return null;
  }
}

function makeToken(): string {
  // short code for dev; can switch to uuid if preferred
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

async function hasActivePasswordResetPending(userId: string): Promise<boolean> {
  const pendingKey = passwordResetPendingKey(userId);
  if (await kvGetString(pendingKey)) return true;
  const p = await getPrisma();
  if (!p) return false;
  const active = await p.passwordResetToken.count({
    where: { userId, expiresAt: { gt: new Date() } },
  });
  return active > 0;
}

async function storePasswordResetToken(
  userId: string,
  token: string,
  ttlSec: number,
): Promise<boolean> {
  const normalizedToken = normalizePasswordResetToken(token);
  const key = passwordResetRedisKey(normalizedToken);
  const kvOk = await kvSetStringWithTtl(key, userId, ttlSec);
  if (kvOk) return true;
  const p = await getPrisma();
  if (!p) return false;
  try {
    await p.passwordResetToken.deleteMany({ where: { userId } });
    await p.passwordResetToken.create({
      data: {
        token: normalizedToken,
        userId,
        expiresAt: new Date(Date.now() + ttlSec * 1000),
      },
    });
    return true;
  } catch (error: unknown) {
    captureKvCacheError(error, "password_reset_db_set");
    return false;
  }
}

async function lookupPasswordResetUserId(
  normalizedToken: string,
): Promise<string | null> {
  const key = passwordResetRedisKey(normalizedToken);
  let userId: string | null = await kvGetString(key);
  if (userId?.startsWith("{")) {
    try {
      const parsed = JSON.parse(userId) as { userId?: string };
      userId = typeof parsed.userId === "string" ? parsed.userId : null;
    } catch {
      userId = null;
    }
  }
  if (userId) return userId;
  const p = await getPrisma();
  if (!p) return null;
  const row = await p.passwordResetToken.findUnique({
    where: { token: normalizedToken },
  });
  if (!row) return null;
  if (row.expiresAt <= new Date()) {
    await p.passwordResetToken
      .delete({ where: { token: normalizedToken } })
      .catch(() => null);
    return null;
  }
  return row.userId;
}

async function clearPasswordResetToken(
  normalizedToken: string,
  userId: string,
): Promise<void> {
  const key = passwordResetRedisKey(normalizedToken);
  await kvDelete(key);
  await clearPasswordResetPending(userId);
  const p = await getPrisma();
  if (p) {
    await p.passwordResetToken
      .deleteMany({ where: { userId } })
      .catch(() => null);
  }
}

async function setPasswordResetPending(
  userId: string,
  ttlSec: number,
): Promise<boolean> {
  const pendingKey = passwordResetPendingKey(userId);
  return kvSetStringWithTtl(pendingKey, "1", ttlSec);
}

async function clearPasswordResetPending(userId: string): Promise<void> {
  const pendingKey = passwordResetPendingKey(userId);
  await kvDelete(pendingKey);
}

export async function createPasswordResetToken(email: string): Promise<{
  ok: boolean;
  token?: string;
  recipientEmail?: string;
  suppressed?: boolean;
}> {
  const p = await getPrisma();
  const user = p
    ? await p.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true, email: true },
      })
    : null;
  if (!user) return { ok: true };
  if (await hasActivePasswordResetPending(user.id)) {
    return { ok: true, suppressed: true };
  }
  const token = makeToken();
  const ttlSec = PASSWORD_RESET_TTL_SEC;
  const stored = await storePasswordResetToken(user.id, token, ttlSec);
  if (!stored) {
    Sentry.captureMessage("password_reset_storage_failed", {
      level: "error",
      tags: { context: "password_reset", component: "kv-cache" },
    });
    return { ok: true };
  }
  await setPasswordResetPending(user.id, ttlSec);
  return { ok: true, token, recipientEmail: user.email ?? email };
}

export async function redeemPasswordResetToken(
  token: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalizedToken = normalizePasswordResetToken(token);
  if (!normalizedToken || !newPassword || newPassword.length < 8)
    return { ok: false, error: "invalid" };
  const userId = await lookupPasswordResetUserId(normalizedToken);
  if (!userId) return { ok: false, error: "invalid_or_expired" };
  const p = await getPrisma();
  if (!p) return { ok: false, error: "db_unavailable" };
  const hash = await bcrypt.hash(newPassword, 10);
  await p.user
    .update({ where: { id: userId }, data: { passwordHash: hash } })
    .catch(() => null);
  await clearPasswordResetToken(normalizedToken, userId);
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

async function listEventRsvpsFromCache(
  eventId: string,
): Promise<{ userId: string; status: RsvpStatus }[]> {
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

async function getUserProfilesFromCache(
  uniqueIds: string[],
): Promise<Record<string, UserProfile>> {
  const out: Record<string, UserProfile> = {};
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

async function getUserRsvpStatsFromCache(
  uniqueIds: string[],
): Promise<Record<string, { total: number; yes: number }>> {
  const out: Record<string, { total: number; yes: number }> = {};
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

function addPrismaKvFallbackBreadcrumb(
  operationName: string,
  extra?: Record<string, unknown>,
): void {
  Sentry.addBreadcrumb({
    category: "postgres",
    message: `Prisma mislukt voor ${operationName}; val terug op cache`,
    level: "warning",
    data: { operationName, ...extra },
  });
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
    try {
      return await withPgConnectRetry("getUserProfiles", async () => {
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
    } catch (error: unknown) {
      if (!shouldFallbackFromPrismaToKv(error)) {
        throw error;
      }
      addPrismaKvFallbackBreadcrumb("getUserProfiles", {
        userCount: uniqueIds.length,
      });
    }
  }

  return getUserProfilesFromCache(uniqueIds);
}

export async function listEventRsvps(
  eventId: string,
): Promise<{ userId: string; status: RsvpStatus }[]> {
  const p = await getPrisma();
  if (p) {
    try {
      return await withPgConnectRetry("listEventRsvps", async () => {
        const rows = await p.rsvp.findMany({ where: { eventId } });
        return rows.map((r: { userId: string; status: unknown }) => ({
          userId: r.userId,
          status: (r.status as RsvpStatus) ?? null,
        }));
      });
    } catch (error: unknown) {
      if (!shouldFallbackFromPrismaToKv(error)) {
        throw error;
      }
      addPrismaKvFallbackBreadcrumb("listEventRsvps", { eventId });
    }
  }
  return listEventRsvpsFromCache(eventId);
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
    try {
      return await withPgConnectRetry("getUserRsvpStats", async () => {
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
    } catch (error: unknown) {
      if (!shouldFallbackFromPrismaToKv(error)) {
        throw error;
      }
      addPrismaKvFallbackBreadcrumb("getUserRsvpStats", {
        userCount: uniqueIds.length,
      });
    }
  }

  return getUserRsvpStatsFromCache(uniqueIds);
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

/**
 * Retrieves a match report for the given event.
 * Primary: PostgreSQL. Fallback: Redis / KV / memory.
 *
 * @param eventId - Calendar event id.
 * @returns The report or null if none exists.
 */
export async function getReport(eventId: string): Promise<MatchReport | null> {
  const p = await getPrisma();
  if (p) {
    const row = await p.matchReport.findUnique({ where: { eventId } });
    if (row) {
      return {
        content: row.content,
        createdAt: row.createdAt.toISOString(),
        authorId: row.authorId ?? undefined,
        mvpResult: (row.mvpResult as MvpResult) ?? undefined,
      };
    }
    return null;
  }

  const key = `report:${eventId}`;
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
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}) as Record<string, unknown>);
    const raw = (data as Record<string, unknown>)?.result ?? null;
    if (!raw) return null;
    try {
      return JSON.parse(raw as string) as MatchReport;
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

/**
 * Stores or removes a match report for the given event.
 * Primary: PostgreSQL (upsert). Also writes to Redis for cache coherence.
 *
 * @param eventId - Calendar event id.
 * @param report - The report to store, or null to delete.
 */
export async function setReport(
  eventId: string,
  report: MatchReport | null,
): Promise<void> {
  const p = await getPrisma();
  if (p) {
    if (report === null) {
      await p.matchReport
        .delete({ where: { eventId } })
        .catch((error: unknown) => {
          Sentry.captureException(error, {
            extra: { eventId, context: "setReport_delete" },
          });
        });
    } else {
      await p.event.upsert({
        where: { id: eventId },
        create: { id: eventId },
        update: {},
      });
      await p.matchReport.upsert({
        where: { eventId },
        create: {
          eventId,
          content: report.content,
          authorId: report.authorId,
          mvpResult: report.mvpResult ?? undefined,
        },
        update: {
          content: report.content,
          authorId: report.authorId,
          mvpResult: report.mvpResult ?? undefined,
        },
      });
    }
    // Also update Redis cache for read performance
    const key = `report:${eventId}`;
    const redis = await getRedis();
    if (redis) {
      if (report === null) {
        await redis.del(key).catch((err: unknown) => {
          Sentry.captureException(err, {
            extra: { eventId, context: "setReport_redis_del" },
          });
        });
      } else {
        await redis.set(key, JSON.stringify(report)).catch((err: unknown) => {
          Sentry.captureException(err, {
            extra: { eventId, context: "setReport_redis_set" },
          });
        });
      }
    }
    return;
  }

  const key = `report:${eventId}`;
  const redis = await getRedis();
  if (redis) {
    if (report === null) {
      await redis.del(key);
      return;
    }
    await redis.set(key, JSON.stringify(report));
    return;
  }
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    await fetch(
      `${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
        },
        body: report ? JSON.stringify(report) : "",
      },
    );
    return;
  }
  if (report === null) memoryStore.delete(key);
  else memoryStore.set(key, JSON.stringify(report) as any);
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
      string | undefined;
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
