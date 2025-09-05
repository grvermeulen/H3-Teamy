import { NextRequest, NextResponse } from "next/server";
import { getReport, setReport } from "../../../lib/kv";
import { getActiveUser } from "../../../lib/activeUser";

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });
  const report = await getReport(eventId);
  return NextResponse.json({ report });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const eventId = body?.eventId as string | undefined;
  const content = body?.content as string | undefined;
  if (!eventId || typeof content !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { userId } = await getActiveUser(req);
  await setReport(eventId, { content, createdAt: new Date().toISOString(), authorId: userId });
  return NextResponse.json({ ok: true });
}
