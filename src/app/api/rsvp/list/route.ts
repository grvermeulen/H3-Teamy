import { NextRequest, NextResponse } from "next/server";
import { getUserProfile, listEventRsvps } from "../../../../lib/kv";

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });
  const countsOnly = req.nextUrl.searchParams.get("countsOnly") === "1";
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
    let name = profile ? `${profile.firstName} ${profile.lastName}`.trim() : `User ${userId.slice(0, 6)}`;
    if (!name) name = `User ${userId.slice(0, 6)}`;
    if (status === "yes") yes.push({ id: userId, name });
    else if (status === "no") no.push({ id: userId, name });
    else if (status === "maybe") maybe.push({ id: userId, name });
  }
  return NextResponse.json({
    counts: { yes: yes.length, no: no.length, maybe: maybe.length },
    lists: countsOnly ? { yes: [], no: [], maybe: [] } : { yes, no, maybe },
  });
}


