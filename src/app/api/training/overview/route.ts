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
  const validUserIds = new Set(users.map((u: any) => u.id));
  const mapName = new Map(users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  
  // Include all attendance data, even for orphaned user IDs (users that may have been deleted)
  // This ensures we don't lose historical data
  const list = Array.from(counts.entries()).map(([userId, attended]) => {
    const isOrphaned = !validUserIds.has(userId);
    const name = mapName.get(userId) || (isOrphaned ? `[Deleted User] ${userId.slice(0,6)}` : `User ${userId.slice(0,6)}`);
    return { userId, name, attended, total, pct: total ? Math.round((attended / total) * 100) : 0, isOrphaned };
  });
  
  const orphanedCount = list.filter((item) => item.isOrphaned).length;
  return NextResponse.json({ from, to, total, list, orphanedCount, debug: { datesChecked: dates.length, datesWithData: Object.keys(map).filter((d) => (map[d] || []).length > 0).length } });
}


