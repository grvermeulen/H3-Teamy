import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "../../../../lib/db";
import {
  defaultSeasonWindow,
  generateTrainingDates,
} from "../../../../lib/training";
import { getAttendanceForDates } from "../../../../lib/kv";
import { hasUserIdentity } from "../../../../lib/userUtils";

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
  let users: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
  }[] = [];
  try {
    users = await prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true, email: true },
    });
  } catch (error: unknown) {
    Sentry.captureException(error);
    return NextResponse.json(
      { error: "users_query_failed", message: "Failed to load users." },
      { status: 500 },
    );
  }
  const mapName = new Map(
    users
      .filter((u: any) => hasUserIdentity(u))
      .map((u: any) => [
        u.id,
        `${(u.firstName || "").trim()} ${(u.lastName || "").trim()}`.trim() ||
          (u.email || "").trim(),
      ]),
  );
  const list = Array.from(counts.entries())
    .filter(([userId]) => mapName.has(userId))
    .map(([userId, attended]) => ({
      userId,
      name: mapName.get(userId) || "",
      attended,
      total,
      pct: total ? Math.round((attended / total) * 100) : 0,
    }))
    .filter((row) => row.name);
  return NextResponse.json({ from, to, total, list });
}
