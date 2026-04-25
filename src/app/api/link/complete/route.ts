import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { redeemLinkCode } from "../../../../lib/kv";
import { mintCookieAnonIdForUser } from "../../../../lib/activeUserCookies";

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json().catch(() => ({ code: "" }));
    if (!code)
      return NextResponse.json({ error: "code required" }, { status: 400 });
    const userId = await redeemLinkCode(String(code).toUpperCase());
    if (!userId)
      return NextResponse.json({ error: "invalid code" }, { status: 400 });
    const anonCookieValue = await mintCookieAnonIdForUser(userId);
    const res = NextResponse.json({ ok: true, userId });
    const isProd = process.env.NODE_ENV === "production";
    res.cookies.set("anon_id", anonCookieValue, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: isProd,
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  } catch (error: unknown) {
    Sentry.captureException(error);
    return NextResponse.json({ error: "Er ging iets mis" }, { status: 500 });
  }
}
