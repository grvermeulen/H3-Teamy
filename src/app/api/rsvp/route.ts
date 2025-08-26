import { NextRequest, NextResponse } from "next/server";
import { getRsvp, setRsvp } from "../../../lib/kv";
import { getActiveUser } from "../../../lib/activeUser";
import { prisma } from "../../../lib/db";

export async function GET(req: NextRequest) {
  try {
    const eventId = req.nextUrl.searchParams.get("eventId");
    if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });
    const { userId } = await getActiveUser(req);
    const status = await getRsvp(userId, eventId);
    return NextResponse.json({ status });
  } catch {
    return NextResponse.json({ status: null });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const eventId = body?.eventId as string | undefined;
    const status = body?.status as "yes" | "no" | "maybe" | null | undefined;
    if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });
    if (status !== "yes" && status !== "no" && status !== "maybe" && status !== null) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    const { userId } = await getActiveUser(req);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const first = (user?.firstName || "").trim();
    const last = (user?.lastName || "").trim();
    if (!first || !last) {
      return NextResponse.json({ error: "profile_incomplete", message: "Please add your first and last name before RSVP-ing." }, { status: 412 });
    }
    await setRsvp(userId, eventId, status ?? null);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}


