import { NextRequest, NextResponse } from "next/server";
import { prisma as prismaClient } from "../../../../lib/db";
import { listEventRsvps, getUserProfile } from "../../../../lib/kv";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get("anon_id")?.value || null;
  const hasDb = Boolean(
    process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL,
  );
  let dbPing: string | null = null;
  let dbError: Record<string, unknown> | null = null;
  let counts: { users?: number; rsvps?: number } = {};
  try {
    if (hasDb) {
      await prismaClient.$queryRaw`SELECT 1`;
      dbPing = "ok";
      const u = await prismaClient.user.count();
      const r = await prismaClient.rsvp.count();
      counts = { users: u, rsvps: r };
    }
  } catch (e) {
    const err = e as Error & {
      code?: unknown;
      meta?: unknown;
      cause?: { message?: string; code?: string; stack?: string } | unknown;
    };
    dbPing = err.message || `${err.name ?? "Error"}: <empty>`;
    const cause = err.cause as { message?: string; code?: string } | undefined;
    dbError = {
      name: err.name,
      code: err.code,
      meta: err.meta,
      causeMessage: cause?.message,
      causeCode: cause?.code,
      stack: err.stack?.split("\n").slice(0, 4).join(" | "),
    };
  }
  const dbHostname = (() => {
    const u = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || "";
    try {
      return u ? new URL(u).hostname : null;
    } catch {
      return "unparseable";
    }
  })();
  return NextResponse.json({
    cookie,
    env: {
      hasDb,
      hasRedis: Boolean(process.env.REDIS_URL),
      dbHostname,
      vercelRegion: process.env.VERCEL_REGION ?? null,
      nodeVersion: process.version,
    },
    db: { ping: dbPing, error: dbError, counts },
  });
}
