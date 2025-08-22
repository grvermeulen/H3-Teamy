import { NextRequest, NextResponse } from "next/server";
import { prisma as prismaClient } from "../../../../lib/db";
import { listEventRsvps, getUserProfile } from "../../../../lib/kv";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get("anon_id")?.value || null;
  const hasDb = Boolean(process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL);
  let dbPing: string | null = null;
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
    dbPing = (e as Error).message;
  }
  return NextResponse.json({
    cookie,
    env: {
      hasDb,
      hasRedis: Boolean(process.env.REDIS_URL),
    },
    db: { ping: dbPing, counts },
  });
}


