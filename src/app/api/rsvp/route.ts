import { NextRequest, NextResponse } from "next/server";
import { getRsvp, setRsvp } from "../../../lib/kv";

function getUserId(req: NextRequest): string | null {
  const id = req.cookies.get("anon_id")?.value || null;
  return id;
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!userId || !eventId) return NextResponse.json({ error: "missing" }, { status: 400 });
  const status = await getRsvp(userId, eventId);
  return NextResponse.json({ status });
}

export async function POST(req: NextRequest) {
  let userId = getUserId(req);
  const body = await req.json().catch(() => ({} as any));
  const eventId = body?.eventId as string | undefined;
  const status = body?.status as "yes" | "no" | "maybe" | null | undefined;
  if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });
  if (status !== "yes" && status !== "no" && status !== "maybe" && status !== null) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  // If cookie missing (first client fetch path), mint one here
  const res = NextResponse.json({ ok: true });
  if (!userId) {
    userId = crypto.randomUUID();
    res.cookies.set("anon_id", userId, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: true,
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  await setRsvp(userId, eventId, status ?? null);
  return res;
}


