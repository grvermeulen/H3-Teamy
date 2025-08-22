import { NextRequest, NextResponse } from "next/server";
import { getUserProfile, setUserProfile } from "../../../lib/kv";

function getUserId(req: NextRequest): string | null {
  return req.cookies.get("anon_id")?.value || null;
}

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ user: null });
  const profile = await getUserProfile(userId);
  return NextResponse.json({ user: profile ? { id: userId, ...profile } : null });
}

export async function POST(req: NextRequest) {
  let userId = getUserId(req);
  const { firstName, lastName } = await req.json();
  if (!firstName || !lastName) return NextResponse.json({ error: "firstName and lastName required" }, { status: 400 });
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
  await setUserProfile(userId, { firstName, lastName });
  return res;
}


