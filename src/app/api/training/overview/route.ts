import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { defaultSeasonWindow, generateTrainingDates } from "../../../../lib/training";
import { getAttendanceForDates } from "../../../../lib/kv";

export async function GET(req: NextRequest) {
  const window = defaultSeasonWindow();
  const from = req.nextUrl.searchParams.get("from") || window.from;
  const to = req.nextUrl.searchParams.get("to") || window.to;
  const dates = generateTrainingDates(new Date(from), new Date(to));
  const total = dates.length;
  // Aggregate present counts per user from KV
  const map = await getAttendanceForDates(dates);
  const counts = new Map<string, number>();
  for (const d of dates) {
    const ids = map[d] || [];
    for (const uid of ids) counts.set(uid, (counts.get(uid) || 0) + 1);
  }
  const users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true } }).catch(() => [] as any[]);
  const mapName = new Map(users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  const list = Array.from(counts.entries()).map(([userId, attended]) => ({ userId, name: mapName.get(userId) || `User ${userId.slice(0,6)}`, attended, total, pct: total ? Math.round((attended / total) * 100) : 0 }));
  return NextResponse.json({ from, to, total, list });
}


