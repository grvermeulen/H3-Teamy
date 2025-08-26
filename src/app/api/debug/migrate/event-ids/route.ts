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
  const byDay = new Map<string, string[]>(); // YYYYMMDD -> canonicalIds
  for (const e of events) {
    const canonical = canonicalEventId(e.title, e.start);
    if (e.uid) map.set(e.uid, canonical);
    const composite = `${e.start}-${e.title}`;
    map.set(composite, canonical);
    const d = new Date(e.start);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const ymd = `${y}${m}${day}`;
    const arr = byDay.get(ymd) || [];
    arr.push(canonical);
    byDay.set(ymd, arr);
  }
  return { map, byDay };
}

export async function GET(req: NextRequest) {
  try {
    if (!allowed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { map, byDay } = await buildMappings();
    const distinct = await prisma.rsvp.findMany({ distinct: ["eventId"], select: { eventId: true, _count: true } as any } as any);
    const plans: { oldId: string; canonicalId: string; count: number; via: string }[] = [];
    for (const row of distinct as any[]) {
      const oldId = row.eventId as string;
      const count = await prisma.rsvp.count({ where: { eventId: oldId } });
      if (count === 0) continue;
      if (map.has(oldId)) { plans.push({ oldId, canonicalId: map.get(oldId)!, count, via: "uid" }); continue; }
      const m = oldId.match(/^(\d{8})/);
      if (m) {
        const cands = byDay.get(m[1]) || [];
        if (cands[0]) plans.push({ oldId, canonicalId: cands[0], count, via: "date" });
      }
    }
    const total = plans.reduce((s, p) => s + p.count, 0);
    return NextResponse.json({ total, plans });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!allowed(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { map, byDay } = await buildMappings();
    const distinct = await prisma.rsvp.findMany({ distinct: ["eventId"], select: { eventId: true } as any } as any);
    let migrated = 0;
    for (const r of distinct as any[]) {
      const oldId = r.eventId as string;
      let canonicalId = map.get(oldId) || "";
      if (!canonicalId) {
        const m = oldId.match(/^(\d{8})/);
        if (m) canonicalId = (byDay.get(m[1]) || [])[0] || "";
      }
      if (!canonicalId) continue;
      const rows = await prisma.rsvp.findMany({ where: { eventId: oldId } });
      for (const row of rows) {
        await prisma.$transaction([
          prisma.rsvp.upsert({
            where: { userId_eventId: { userId: row.userId, eventId: canonicalId } },
            create: { userId: row.userId, eventId: canonicalId, status: row.status },
            update: { status: row.status },
          }),
          prisma.rsvp.deleteMany({ where: { userId: row.userId, eventId: oldId } }),
        ]);
        migrated += 1;
      }
    }
    return NextResponse.json({ migrated });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}


