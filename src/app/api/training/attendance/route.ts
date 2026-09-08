import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAttendance, setAttendanceBatch } from "../../../../lib/kv";
import { isTrainer } from "../../../../lib/trainer";

/**
 * What a trainer sends: the day, and who was there.
 *
 * Each id is validated as a non-empty string rather than the array merely being an array:
 * `setAttendanceBatch` clears the day first and then writes these as user ids, so a `null` or a
 * number that slipped through would cost the existing attendance for that day.
 */
const PutAttendanceSchema = z.object({
  date: z.string().min(1),
  presentUserIds: z.array(z.string().min(1)),
});

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (!date)
    return NextResponse.json({ error: "date required" }, { status: 400 });
  const presentUserIds = await getAttendance(date);
  return NextResponse.json({ date, presentUserIds });
}

export async function PUT(req: NextRequest) {
  const { isTrainer: ok, me } = await isTrainer(req);
  if (!ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body: unknown = await req.json().catch(() => null);
  const parsed = PutAttendanceSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Ongeldige opkomstgegevens" },
      { status: 400 },
    );
  const { date, presentUserIds } = parsed.data;
  await setAttendanceBatch(date, presentUserIds, me.id);
  return NextResponse.json({ ok: true });
}
