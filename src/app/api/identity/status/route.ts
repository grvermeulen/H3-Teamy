import { NextRequest, NextResponse } from "next/server";
import { getActiveUser } from "../../../../lib/activeUser";

export async function GET(req: NextRequest) {
  const res = await getActiveUser(req);
  return NextResponse.json({ needsLink: res.needsLink });
}
