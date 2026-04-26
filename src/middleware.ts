import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  NEXT_ROUTER_STATE_TREE_HEADER,
  flightRequestPartsFromNextRequest,
  shouldDropStaleFlightRouterStateTree,
} from "./lib/middlewareRsc";

/**
 * Zet een `anon_id`-cookie voor anonieme flows en verwijdert een stale
 * `next-router-state-tree` op App Router flight-fetches (na deploy; zie vercel/next.js#92907).
 */
export function middleware(request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers);
  if (
    shouldDropStaleFlightRouterStateTree(
      flightRequestPartsFromNextRequest(request),
    )
  ) {
    requestHeaders.delete(NEXT_ROUTER_STATE_TREE_HEADER);
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

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
