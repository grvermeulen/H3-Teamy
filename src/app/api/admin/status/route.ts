import { NextRequest, NextResponse } from "next/server";
import { isAdminUser } from "../../../../lib/trainer";

export async function GET(req: NextRequest) {
  const { isAdmin, me } = await isAdminUser(req);
  return NextResponse.json({ isAdmin, me });
}


