import { NextResponse } from "next/server";
import { fetchTeamEvents } from "../../../lib/ical";

export const revalidate = 3600; // Cache for 1 hour - events don't change frequently

export async function GET() {
  try {
    const events = await fetchTeamEvents();
    return NextResponse.json({ events }, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}


