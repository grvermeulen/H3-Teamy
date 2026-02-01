import { NextRequest, NextResponse } from "next/server";
import { getAttendance, listAllAttendanceKeys } from "../../../../lib/kv";
import { isAdminUser } from "../../../../lib/trainer";

export async function GET(req: NextRequest) {
  const { isAdmin } = await isAdminUser(req);
  if (!isAdmin)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const date = req.nextUrl.searchParams.get("date");
  if (date) {
    // Check specific date
    const data = await getAttendance(date);
    return NextResponse.json({
      date,
      found: data.length > 0,
      count: data.length,
      userIds: data,
    });
  }

  // List all available attendance keys
  const keys = await listAllAttendanceKeys();
  const sample: Record<string, number> = {};
  // Sample a few dates to show data
  for (const key of keys.slice(0, 10)) {
    const data = await getAttendance(key);
    sample[key] = data.length;
  }
  return NextResponse.json({
    totalKeys: keys.length,
    keys: keys.slice(0, 50), // First 50 keys
    sample,
  });
}
