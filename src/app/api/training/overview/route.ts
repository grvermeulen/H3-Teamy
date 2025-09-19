import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import { defaultSeasonWindow, generateTrainingDates } from "../../../../lib/training";

export async function GET(req: NextRequest) {
  const window = defaultSeasonWindow();
  const from = req.nextUrl.searchParams.get("from") || window.from;
  const to = req.nextUrl.searchParams.get("to") || window.to;
  const dates = generateTrainingDates(new Date(from), new Date(to));
  const total = dates.length;
  // Aggregate present counts per user
  const rows = await prisma.attendance.groupBy({ by: ["userId"], _count: { userId: true } }).catch(() => [] as any[]);
  const users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true } }).catch(() => [] as any[]);
  const mapName = new Map(users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  const list = rows.map((r: any) => ({ userId: r.userId, name: mapName.get(r.userId) || `User ${r.userId.slice(0,6)}`, attended: r._count.userId, total, pct: total ? Math.round((r._count.userId / total) * 100) : 0 }));
  return NextResponse.json({ from, to, total, list });
}


