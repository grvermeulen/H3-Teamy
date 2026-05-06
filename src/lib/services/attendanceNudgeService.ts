import * as Sentry from "@sentry/nextjs";
import {
  generateAttendanceNudge,
  type AttendanceNudge,
} from "../ai/attendanceNudge";
import { kvGetJson, kvSetJson, getAttendanceForDates } from "../kv";
import {
  describeRelativeDay,
  generateTrainingDates,
  nextTrainingDate,
  toYMD,
} from "../training";

/** Bucket the player's last-14-day attendance falls into, with raw counts. */
export type NudgeBucket = {
  tone: "encourage" | "cheer";
  attended: number;
  total: number;
  pct: number;
};

/**
 * Pure decision: does this attendance window warrant a nudge, and which tone?
 *
 * Rules:
 * - Window must have ≥ 2 scheduled trainings — single-training windows skew too
 *   easily on holidays.
 * - 100% attendance with ≥ 2 attended → `cheer`.
 * - Below 50% → `encourage`.
 * - Otherwise → `null` (mid-range, no nudge).
 *
 * @param attended - Trainings the player attended in the window (can be 0).
 * @param total - Trainings scheduled in the window.
 */
export function decideNudgeBucket(
  attended: number,
  total: number,
): NudgeBucket | null {
  if (!Number.isFinite(attended) || !Number.isFinite(total)) return null;
  if (total < 2) return null;
  if (attended < 0 || attended > total) return null;
  const pct = Math.round((attended / total) * 100);
  if (attended === total && attended >= 2) {
    return { tone: "cheer", attended, total, pct };
  }
  if (pct < 50) {
    return { tone: "encourage", attended, total, pct };
  }
  return null;
}

/**
 * Computes the user's attendance counts in the rolling 14-day window ending on
 * `today` (inclusive). `today` is parameterized so tests can pin a date.
 */
export async function computeRecentAttendance(
  userId: string,
  today: Date = new Date(),
): Promise<{ attended: number; total: number }> {
  const from = new Date(today);
  from.setDate(from.getDate() - 13);
  const dates = generateTrainingDates(from, today);
  if (dates.length === 0) return { attended: 0, total: 0 };
  const map = await getAttendanceForDates(dates);
  let attended = 0;
  for (const d of dates) {
    if ((map[d] || []).includes(userId)) attended++;
  }
  return { attended, total: dates.length };
}

function staticFallback(
  bucket: NudgeBucket,
  nextTrainingLabel?: string,
): AttendanceNudge {
  if (bucket.tone === "cheer") {
    return {
      tone: "cheer",
      message:
        "Alle trainingen erop zitten in twee weken — dat zien we. Ga zo door.",
    };
  }
  const dayPart = nextTrainingLabel
    ? `De bak ligt klaar ${nextTrainingLabel} — kom je weer aansluiten?`
    : "De bak ligt klaar — kom je weer aansluiten?";
  return {
    tone: "encourage",
    message: `Druk gehad? Geen ramp. ${dayPart}`,
  };
}

function cacheKey(userId: string, today: Date, bucket: NudgeBucket): string {
  return `nudge:v3:${userId}:${toYMD(today)}:${bucket.tone}:${bucket.attended}of${bucket.total}`;
}

/**
 * Returns the cached nudge for this user/day/bucket, or generates a fresh one
 * via the LLM and caches it. On AI failure, returns a static Dutch fallback so
 * the UI never has to render "AI down".
 */
export async function getOrCreateNudge(
  userId: string,
  bucket: NudgeBucket,
  opts: { firstName?: string; today?: Date } = {},
): Promise<AttendanceNudge> {
  const today = opts.today ?? new Date();
  const key = cacheKey(userId, today, bucket);
  const cached = await kvGetJson<AttendanceNudge>(key).catch(() => null);
  if (cached && cached.tone === bucket.tone && cached.message) {
    return cached;
  }

  let nextTrainingLabel: string | undefined;
  if (bucket.tone === "encourage") {
    const nextDate = nextTrainingDate(today);
    if (nextDate) nextTrainingLabel = describeRelativeDay(nextDate, today);
  }

  try {
    const fresh = await generateAttendanceNudge({
      tone: bucket.tone,
      attended: bucket.attended,
      total: bucket.total,
      firstName: opts.firstName,
      nextTrainingLabel,
    });
    await kvSetJson(key, fresh).catch(() => {});
    return fresh;
  } catch (err) {
    Sentry.captureException(err, {
      tags: { component: "attendance-nudge" },
      extra: { userId, bucket: bucket.tone },
    });
    return staticFallback(bucket, nextTrainingLabel);
  }
}
