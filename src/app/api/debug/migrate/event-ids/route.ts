import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/db";
import { fetchTeamEvents } from "../../../../../lib/ical";
import { canonicalEventId } from "../../../../../lib/eventId";

function allowed(req: NextRequest): boolean {
  const configured = process.env.ADMIN_MAINT_TOKEN || "";
  if (!configured) return true; // allow if not configured
  const token = req.nextUrl.searchParams.get("token") || req.headers.get("x-admin-token") || "";
  return token === configured;
}

async function buildMappings() {
  const events = await fetchTeamEvents();
  const map = new Map<string, string>(); // oldId -> canonicalId
  for (const e of events) {
    const canonical = canonicalEventId(e.title, e.start);
    if (e.uid) map.set(e.uid, canonical);
    const composite = `${e.start}-${e.title}`;
    map.set(composite, canonical);
  }
  return map;
}

export async function GET(req: NextRequest) {
  if (!allowed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const map = await buildMappings();
  const plans: { oldId: string; canonicalId: string; count: number }[] = [];
  for (const [oldId, canonicalId] of map.entries()) {
    const count = await prisma.rsvp.count({ where: { eventId: oldId } });
    if (count > 0) plans.push({ oldId, canonicalId, count });
  }
  const total = plans.reduce((s, p) => s + p.count, 0);
  return NextResponse.json({ total, plans });
}

export async function POST(req: NextRequest) {
  if (!allowed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const map = await buildMappings();
  let migrated = 0;
  for (const [oldId, canonicalId] of map.entries()) {
    const rows = await prisma.rsvp.findMany({ where: { eventId: oldId } });
    if (rows.length === 0) continue;
    for (const row of rows) {
      await prisma.$transaction([
        prisma.rsvp.upsert({
          where: { userId_eventId: { userId: row.userId, eventId: canonicalId } },
          create: { userId: row.userId, eventId: canonicalId, status: row.status },
          update: { status: row.status },
        }),
        prisma.rsvp.delete({ where: { userId_eventId: { userId: row.userId, eventId: oldId } } }).catch(() => null),
      ]);
      migrated += 1;
    }
  }
  return NextResponse.json({ migrated });
}


