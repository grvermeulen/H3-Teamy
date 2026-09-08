import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { fetchTeamEvents } from "../../../lib/ical";

export const revalidate = 0;

export async function GET() {
  try {
    const events = await fetchTeamEvents();
    return NextResponse.json({ events });
  } catch (error: unknown) {
    // The message may carry an upstream URL or a stack; that belongs in Sentry, not in a response.
    Sentry.captureException(error, { tags: { area: "events", kind: "list" } });
    return NextResponse.json(
      { error: "Kon de wedstrijden niet laden" },
      { status: 500 },
    );
  }
}
