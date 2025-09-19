type RsvpStatus = "yes" | "no" | "maybe" | null;
type UserProfile = { firstName: string; lastName: string };
let prismaLoaded = false as boolean;
let prisma: any = null as any;
async function getPrisma() {
  if (prismaLoaded) return prisma;
  if (!process.env.DATABASE_URL) { prismaLoaded = true; prisma = null; return null; }
  const mod = await import("./db");
  prisma = (mod as any).prisma;
  prismaLoaded = true;
  return prisma;
}

// Simple in-memory fallback store (not persistent across server restarts)
const memoryStore = new Map<string, RsvpStatus>();

// Vercel KV compatibility if provided via env
// Expect standard env: KV_REST_API_URL, KV_REST_API_TOKEN, KV_REST_API_READ_ONLY_TOKEN, KV_URL
// Also supports Redis via REDIS_URL using ioredis
let redisClient: any = null;
async function getRedis() {
  if (redisClient) return redisClient;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const { default: IORedis } = await import("ioredis");
  redisClient = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  try { await redisClient.connect?.(); } catch {}
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
  const data = await res.json().catch(() => ({} as any));
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

export async function getRsvp(userId: string, eventId: string): Promise<RsvpStatus> {
  const p = await getPrisma();
  if (p) {
    const rec = await p.rsvp.findUnique({ where: { userId_eventId: { userId, eventId } } });
    const val = (rec?.status as RsvpStatus) ?? null;
    if (val !== "yes" && val !== "no" && val !== "maybe") return null;
    return val;
  }
  const key = `rsvp:${userId}:${eventId}`;
  return kvGet(key);
}

export async function setRsvp(userId: string, eventId: string, status: RsvpStatus): Promise<void> {
  const p = await getPrisma();
  if (p) {
    if (status === null) {
      await p.rsvp.delete({ where: { userId_eventId: { userId, eventId } } }).catch(() => {});
    } else {
      // Ensure user exists to satisfy FK constraint
      await p.user.upsert({
        where: { id: userId },
        create: { id: userId, firstName: "", lastName: "" },
        update: {},
      });
      await p.rsvp.upsert({ where: { userId_eventId: { userId, eventId } }, create: { userId, eventId, status }, update: { status } });
    }
    return;
  }
  const key = `rsvp:${userId}:${eventId}`;
  await kvSet(key, status);
}

export async function setUserProfile(userId: string, profile: UserProfile) {
  const p = await getPrisma();
  if (p) {
    await p.user.upsert({ where: { id: userId }, create: { id: userId, firstName: profile.firstName, lastName: profile.lastName }, update: { firstName: profile.firstName, lastName: profile.lastName } });
    return;
  }
  const key = `user:${userId}`;
  const redis = await getRedis();
  if (redis) { await redis.hset(key, { firstName: profile.firstName, lastName: profile.lastName }); return; }
  memoryStore.set(key, JSON.stringify(profile) as any);
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const p = await getPrisma();
  if (p) {
    const u = await p.user.findUnique({ where: { id: userId } });
    if (!u) return null;
    return { firstName: u.firstName, lastName: u.lastName };
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
  try { return JSON.parse(raw); } catch { return null; }
}

export async function listEventRsvps(eventId: string): Promise<{ userId: string; status: RsvpStatus }[]> {
  const p = await getPrisma();
  if (p) {
    const rows = await p.rsvp.findMany({ where: { eventId } });
    return rows.map((r: any) => ({ userId: r.userId, status: (r.status as RsvpStatus) ?? null }));
  }
  const redis = await getRedis();
  if (redis) {
    const keys: string[] = await redis.keys(`rsvp:*:${eventId}`);
    if (keys.length === 0) return [];
    const vals = await redis.mget(keys);
    return keys.map((k, i) => ({ userId: k.split(":")[1]!, status: (vals[i] as RsvpStatus) ?? null }));
  }
  const out: { userId: string; status: RsvpStatus }[] = [];
  for (const [k, v] of memoryStore.entries()) {
    if (typeof k === "string" && k.startsWith(`rsvp:`) && k.endsWith(`:${eventId}`)) {
      const userId = k.split(":")[1] || "";
      const status = (v as RsvpStatus) ?? null;
      out.push({ userId, status });
    }
  }
  return out;
}

// Match Reports
type MatchReport = { content: string; createdAt: string; authorId?: string };

export async function getReport(eventId: string): Promise<MatchReport | null> {
  const key = `report:${eventId}`;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    const redis = await getRedis();
    if (redis) {
      const raw = (await redis.get(key)) as string | null;
      if (!raw) return null;
      try { return JSON.parse(raw) as MatchReport; } catch { return null; }
    }
    const raw = memoryStore.get(key) as unknown as string | undefined;
    if (!raw) return null;
    try { return JSON.parse(raw) as MatchReport; } catch { return null; }
  }
  const url = `${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
    },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({} as any));
  const raw = data?.result ?? null;
  if (!raw) return null;
  try { return JSON.parse(raw) as MatchReport; } catch { return null; }
}

export async function setReport(eventId: string, report: MatchReport | null): Promise<void> {
  const key = `report:${eventId}`;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    const redis = await getRedis();
    if (redis) {
      if (report === null) { await redis.del(key); return; }
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
  const key = `att:${dateYmd}`;
  const redis = await getRedis();
  if (redis) {
    const raw = (await redis.get(key)) as string | null;
    if (!raw) return [];
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }
  const raw = memoryStore.get(key) as unknown as string | undefined;
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

export async function setAttendanceBatch(dateYmd: string, presentUserIds: string[], markedBy: string): Promise<void> {
  const key = `att:${dateYmd}`;
  const redis = await getRedis();
  const payload = JSON.stringify(presentUserIds);
  if (redis) { await redis.set(key, payload); return; }
  memoryStore.set(key, payload as any);
}

export async function getAttendanceForDates(dates: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const redis = await getRedis();
  if (redis) {
    if (dates.length === 0) return out;
    const keys = dates.map((d) => `att:${d}`);
    const vals = await redis.mget(keys);
    for (let i = 0; i < dates.length; i++) {
      const raw = vals[i] as string | null;
      if (!raw) { out[dates[i]] = []; continue; }
      try { out[dates[i]] = JSON.parse(raw) as string[]; } catch { out[dates[i]] = []; }
    }
    return out;
  }
  for (const d of dates) {
    const raw = memoryStore.get(`att:${d}`) as unknown as string | undefined;
    if (!raw) { out[d] = []; continue; }
    try { out[d] = JSON.parse(raw) as string[]; } catch { out[d] = []; }
  }
  return out;
}

// Roles (admin/trainer/player) stored in KV/Redis for simplicity
type Roles = { admin?: boolean; trainer?: boolean; player?: boolean };

export async function getUserRoles(userId: string): Promise<Roles> {
  const key = `roles:${userId}`;
  const redis = await getRedis();
  if (redis) {
    const raw = (await redis.get(key)) as string | null;
    if (!raw) return { player: true };
    try { return JSON.parse(raw) as Roles; } catch { return { player: true }; }
  }
  const raw = memoryStore.get(key) as unknown as string | undefined;
  if (!raw) return { player: true };
  try { return JSON.parse(raw) as Roles; } catch { return { player: true }; }
}

export async function setUserRoles(userId: string, roles: Roles): Promise<void> {
  const key = `roles:${userId}`;
  const payload = JSON.stringify(roles);
  const redis = await getRedis();
  if (redis) { await redis.set(key, payload); return; }
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


