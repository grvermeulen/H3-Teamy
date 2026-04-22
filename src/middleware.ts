import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  NEXT_RSC_HEADER,
  NEXT_RSC_UNION_QUERY,
  NEXT_ROUTER_STATE_TREE_HEADER,
  shouldDropStaleFlightRouterStateTree,
} from "@/lib/nextFlightRequest";

/**
 * Ensures each visitor has an `anon_id` cookie for anonymous identity flows.
 * Strips stale `next-router-state-tree` on App Router flight fetches to avoid 500s after deploy (Next.js #92907).
 */
export function middleware(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname;
  const hasRscQuery = request.nextUrl.searchParams.has(NEXT_RSC_UNION_QUERY);
  const rscHeader = request.headers.get(NEXT_RSC_HEADER);

  const requestHeaders = new Headers(request.headers);
  if (
    shouldDropStaleFlightRouterStateTree({
      pathname,
      hasRscQuery,
      rscHeader,
    })
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
