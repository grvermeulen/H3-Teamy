import { NextRequest, NextResponse } from "next/server";
import { getAttendance, setAttendanceBatch } from "../../../../lib/kv";
import { isTrainer } from "../../../../lib/trainer";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });
  const presentUserIds = await getAttendance(date);
  return NextResponse.json({ date, presentUserIds });
}

export async function PUT(req: NextRequest) {
  const { isTrainer: ok, me } = await isTrainer(req);
  if (!ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({} as any));
  const date = (body?.date as string) || "";
  const presentUserIds = Array.isArray(body?.presentUserIds) ? (body.presentUserIds as string[]) : [];
  if (!date) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await setAttendanceBatch(date, presentUserIds, me.id);
  return NextResponse.json({ ok: true });
}



