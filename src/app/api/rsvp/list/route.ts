import { NextRequest, NextResponse } from "next/server";
import { getUserProfile, listEventRsvps, listUserRsvps } from "../../../../lib/kv";
import { getBadgeForAttendance } from "../../../../lib/badges";

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });
  const countsOnly = req.nextUrl.searchParams.get("countsOnly") === "1";
  let items: { userId: string; status: any }[] = [];
  try {
    items = await listEventRsvps(eventId);
  } catch (e: any) {
    return NextResponse.json({ error: "list_failed", message: e?.message || String(e) }, { status: 500 });
  }
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
    const name = profile && profile.firstName ? profile.firstName : `User ${userId.slice(0, 6)}`;
    // Compute simple attendance percentage as Yes/(Yes+No+Maybe) across all events (kept for potential future use)
    try {
      const history = await listUserRsvps(userId);
      const total = history.length;
      const yesCount = history.filter((h) => h.status === "yes").length;
      void getBadgeForAttendance(total > 0 ? (yesCount / total) * 100 : 0);
    } catch {}
    if (status === "yes") yes.push({ id: userId, name });
    else if (status === "no") no.push({ id: userId, name });
    else if (status === "maybe") maybe.push({ id: userId, name });
  }
  return NextResponse.json({
    counts: { yes: yes.length, no: no.length, maybe: maybe.length },
    lists: countsOnly ? { yes: [], no: [], maybe: [] } : { yes, no, maybe },
  });
}


