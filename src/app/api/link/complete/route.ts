import { NextRequest, NextResponse } from "next/server";
import { redeemLinkCode } from "../../../../lib/kv";

export async function POST(req: NextRequest) {
  const { code } = await req.json().catch(() => ({ code: "" }));
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });
  const userId = await redeemLinkCode(String(code).toUpperCase());
  if (!userId) return NextResponse.json({ error: "invalid code" }, { status: 400 });
  const res = NextResponse.json({ ok: true, userId });
  // Overwrite anon_id cookie with the linked userId
  res.cookies.set("anon_id", userId, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true,
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}


