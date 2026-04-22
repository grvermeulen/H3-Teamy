/** Header names aligned with `next/dist/client/components/app-router-headers` (App Router flight). */
export const NEXT_RSC_HEADER = "rsc" as const;
export const NEXT_ROUTER_STATE_TREE_HEADER =
  "next-router-state-tree" as const;
export const NEXT_RSC_UNION_QUERY = "_rsc" as const;

export type FlightRequestParts = {
  pathname: string;
  /** True when the URL includes the `_rsc` query param (RSC union / soft navigation fetch). */
  hasRscQuery: boolean;
  /** Value of the `rsc` request header, if present. */
  rscHeader: string | null;
};

/**
 * Detects App Router "flight" requests (RSC payload fetches), excluding API routes and Next internals.
 *
 * @param parts - Normalized path and flight markers from the incoming request.
 * @returns Whether this looks like a client-initiated RSC fetch that may carry `next-router-state-tree`.
 */
export function isNextAppRouterFlightFetch(parts: FlightRequestParts): boolean {
  const { pathname, hasRscQuery, rscHeader } = parts;
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next")) {
    return false;
  }
  return hasRscQuery || rscHeader === "1";
}

/**
 * Next.js 16.2+ can throw when a stale client sends an older-encoded `next-router-state-tree` after a
 * deploy (see vercel/next.js#92907). Dropping the header lets the server fall back like an absent header.
 *
 * @param parts - Normalized path and flight markers from the incoming request.
 * @returns Whether middleware should remove `next-router-state-tree` before the App Router runs.
 */
export function shouldDropStaleFlightRouterStateTree(
  parts: FlightRequestParts,
): boolean {
  return isNextAppRouterFlightFetch(parts);
}
