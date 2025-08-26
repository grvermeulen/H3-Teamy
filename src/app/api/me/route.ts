import { NextRequest, NextResponse } from "next/server";
import { getUserProfile, setUserProfile } from "../../../lib/kv";
import { getActiveUser } from "../../../lib/activeUser";

export async function GET(req: NextRequest) {
  const { userId } = await getActiveUser(req);
  const profile = await getUserProfile(userId);
  return NextResponse.json({ user: profile ? { id: userId, ...profile } : null });
}

export async function POST(req: NextRequest) {
  const { userId } = await getActiveUser(req);
  const { firstName, lastName } = await req.json();
  if (!firstName || !lastName) return NextResponse.json({ error: "firstName and lastName required" }, { status: 400 });
  await setUserProfile(userId, { firstName, lastName });
  return NextResponse.json({ ok: true });
}


