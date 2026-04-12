import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Ensures each visitor has an `anon_id` cookie for anonymous identity flows.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const cookieName = "anon_id";
  const existing = request.cookies.get(cookieName)?.value;
  if (!existing) {
    const id = crypto.randomUUID();
    const isProd = process.env.NODE_ENV === "production";
    response.cookies.set(cookieName, id, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: isProd,
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
