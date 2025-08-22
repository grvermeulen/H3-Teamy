import { NextResponse } from "next/server";
import { fetchTeamEvents } from "../../../lib/ical";

export const revalidate = 0;

export async function GET() {
  try {
    const events = await fetchTeamEvents();
    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}


