import { NextRequest, NextResponse } from "next/server";
import { getSeasonEvents, syncEventsFromIcal } from "../../../lib/events";

export const revalidate = 3600; // Cache for 1 hour - events don't change frequently

export async function GET(req: NextRequest) {
  try {
    const includePast = req.nextUrl.searchParams.get("includePast") === "1";
    const sync = req.nextUrl.searchParams.get("sync") === "1";

    if (sync) {
      // Opportunistic sync; does not block serving cached DB results afterward
      try { await syncEventsFromIcal(); } catch {}
    }

    const events = await getSeasonEvents(includePast);
    return NextResponse.json({ events }, {
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}


