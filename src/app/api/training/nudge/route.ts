import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/authOptions";
import { getActiveUser } from "../../../../lib/activeUser";
import { getUserProfile } from "../../../../lib/kv";
import {
  computeRecentAttendance,
  decideNudgeBucket,
  getOrCreateNudge,
} from "../../../../lib/services/attendanceNudgeService";

export const dynamic = "force-dynamic";

/**
 * Returns an attendance nudge for the active player based on the rolling
 * 14-day training-attendance window. Anonymous visitors always get
 * `{ nudge: null }` — the feature is only meaningful for accounts that have
 * appeared on training rosters.
 *
 * Response shape:
 * - `{ nudge: null }` when the user is mid-range, the window is too thin, or
 *   no session is present.
 * - `{ nudge: { tone, message } }` for `encourage` (<50%) or `cheer` (100%).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ nudge: null });
    }

    const { userId } = await getActiveUser(req);
    const { attended, total } = await computeRecentAttendance(userId);
    const bucket = decideNudgeBucket(attended, total);
    if (!bucket) {
      return NextResponse.json({ nudge: null });
    }

    const profile = await getUserProfile(userId).catch(() => null);
    const firstName = profile?.firstName?.trim() || undefined;
    const nudge = await getOrCreateNudge(userId, bucket, { firstName });

    return NextResponse.json({ nudge });
  } catch (err: unknown) {
    Sentry.captureException(err, { tags: { component: "api-training-nudge" } });
    return NextResponse.json({ nudge: null });
  }
}
