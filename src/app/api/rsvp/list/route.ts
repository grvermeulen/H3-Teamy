import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  getUserProfiles,
  getUserRsvpStats,
  listEventRsvps,
} from "../../../../lib/kv";
import { getBadgeForAttendance } from "../../../../lib/badges";
import { withDbRequestMetrics } from "../../../../lib/dbMetrics";
import { displayName } from "../../../../lib/userUtils";

const UNKNOWN_RSVP_NAME = "Onbekende speler";

/**
 * Returns RSVP counts and, when requested, the named RSVP lists for an event.
 *
 * @param req - Incoming request containing the event identifier and optional countsOnly flag.
 * @returns JSON response with RSVP counts and grouped attendee lists.
 */
export async function GET(req: NextRequest) {
  return withDbRequestMetrics("api/rsvp/list.GET", async () => {
    const eventId = req.nextUrl.searchParams.get("eventId");
    if (!eventId)
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    const countsOnly = req.nextUrl.searchParams.get("countsOnly") === "1";
    type RsvpStatus = "yes" | "no" | "maybe" | null;
    let items: { userId: string; status: RsvpStatus }[] = [];
    try {
      items = await listEventRsvps(eventId);
    } catch (e: unknown) {
      Sentry.captureException(e);
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: "list_failed", message },
        { status: 500 },
      );
    }
    const yes: { id: string; name: string }[] = [];
    const no: { id: string; name: string }[] = [];
    const maybe: { id: string; name: string }[] = [];
    const counts = { yes: 0, no: 0, maybe: 0 };
    const userIds = Array.from(new Set(items.map((item) => item.userId)));
    const profilesById = countsOnly ? {} : await getUserProfiles(userIds);
    const statsById = countsOnly ? {} : await getUserRsvpStats(userIds);
    for (const { userId, status } of items) {
      if (status === "yes") counts.yes += 1;
      else if (status === "no") counts.no += 1;
      else if (status === "maybe") counts.maybe += 1;
      if (countsOnly) {
        continue;
      }
      const profile = profilesById[userId];
      const resolvedDisplayName =
        displayName(profile ?? {}) || UNKNOWN_RSVP_NAME;
      // Compute simple attendance percentage as Yes/(Yes+No+Maybe) across all events (kept for potential future use)
      try {
        const stats = statsById[userId] || { total: 0, yes: 0 };
        const total = stats.total;
        const yesCount = stats.yes;
        void getBadgeForAttendance(total > 0 ? (yesCount / total) * 100 : 0);
      } catch (error: unknown) {
        Sentry.captureException(error);
      }
      if (status === "yes") yes.push({ id: userId, name: resolvedDisplayName });
      else if (status === "no")
        no.push({ id: userId, name: resolvedDisplayName });
      else if (status === "maybe")
        maybe.push({ id: userId, name: resolvedDisplayName });
    }
    return NextResponse.json({
      counts,
      lists: countsOnly ? { yes: [], no: [], maybe: [] } : { yes, no, maybe },
    });
  });
}
