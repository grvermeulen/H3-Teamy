import { NextRequest, NextResponse } from "next/server";
import { getUserProfile, listEventRsvps } from "../../../../lib/kv";
import * as Sentry from "@sentry/nextjs";

export async function GET(req: NextRequest) {
  return Sentry.startSpan(
    {
      op: "http.server",
      name: "GET /api/rsvp/list",
    },
    async (span) => {
      const eventId = req.nextUrl.searchParams.get("eventId");
      if (!eventId) {
        return NextResponse.json({ error: "eventId required" }, { status: 400 });
      }

      const countsOnly = req.nextUrl.searchParams.get("countsOnly") === "1";
      span.setAttribute("eventId", eventId);
      span.setAttribute("countsOnly", countsOnly);

      const p = await import("../../../../lib/db").then(m => m.prisma);
      if (p) {
        // Optimized query: get RSVPs with user profiles in one query
        const queryStart = Date.now();
        const rsvpsWithUsers = await p.rsvp.findMany({
          where: { eventId },
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true }
            }
          }
        });
        const queryDuration = Date.now() - queryStart;

        span.setAttribute("query.type", "optimized_join");
        span.setAttribute("query.duration_ms", queryDuration);
        span.setAttribute("results.count", rsvpsWithUsers.length);

        const yes: { id: string; name: string }[] = [];
        const no: { id: string; name: string }[] = [];
        const maybe: { id: string; name: string }[] = [];

        for (const rsvp of rsvpsWithUsers) {
          const user = rsvp.user;
          const name = user && user.firstName ? user.firstName : `User ${user?.id.slice(0, 6) || 'unknown'}`;

          if (rsvp.status === "yes") yes.push({ id: rsvp.userId, name });
          else if (rsvp.status === "no") no.push({ id: rsvp.userId, name });
          else if (rsvp.status === "maybe") maybe.push({ id: rsvp.userId, name });
        }

        span.setAttribute("rsvp.yes_count", yes.length);
        span.setAttribute("rsvp.no_count", no.length);
        span.setAttribute("rsvp.maybe_count", maybe.length);

        return NextResponse.json({
          counts: { yes: yes.length, no: no.length, maybe: maybe.length },
          lists: countsOnly ? { yes: [], no: [], maybe: [] } : { yes, no, maybe },
        }, {
          headers: {
            'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600', // Cache for 5 minutes
          },
        });
      }

      // Fallback to original implementation if Prisma is not available
      const items = await listEventRsvps(eventId);
      const yes: { id: string; name: string }[] = [];
      const no: { id: string; name: string }[] = [];
      const maybe: { id: string; name: string }[] = [];
      for (const { userId, status } of items) {
        if (countsOnly) {
          if (status === "yes") yes.push({ id: userId, name: "" });
          else if (status === "no") no.push({ id: userId, name: "" });
          else if (status === "maybe") maybe.push({ id: userId, name: "" });
          continue;
        }
        const profile = await getUserProfile(userId);
        let name = profile && profile.firstName ? profile.firstName : `User ${userId.slice(0, 6)}`;
        if (status === "yes") yes.push({ id: userId, name });
        else if (status === "no") no.push({ id: userId, name });
        else if (status === "maybe") maybe.push({ id: userId, name });
      }
      return NextResponse.json({
        counts: { yes: yes.length, no: no.length, maybe: maybe.length },
        lists: countsOnly ? { yes: [], no: [], maybe: [] } : { yes, no, maybe },
      }, {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600', // Cache for 5 minutes
        },
      });
    }
  );
}


