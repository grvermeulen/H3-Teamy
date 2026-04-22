import type { NextRequest } from "next/server";

/** App Router flight: `rsc` request header (zie `next/dist/client/components/app-router-headers`). */
export const NEXT_RSC_HEADER = "rsc" as const;
/** App Router RSC-union query key (`?_rsc=...`). */
export const NEXT_RSC_UNION_QUERY = "_rsc" as const;
/** Serialized flight router state (kan stale zijn na deploy, zie vercel/next.js#92907). */
export const NEXT_ROUTER_STATE_TREE_HEADER =
  "next-router-state-tree" as const;

export type FlightRequestParts = {
  pathname: string;
  /** True wanneer de URL `_rsc` bevat (soft navigation / RSC-fetch). */
  hasRscQuery: boolean;
  /** Waarde van de `rsc`-header, indien aanwezig. */
  rscHeader: string | null;
};

/**
 * Detecteert App Router RSC-flight requests (`?_rsc=...`).
 *
 * @param request - Binnenkomend NextRequest (inclusief querystring).
 * @returns `true` wanneer het een RSC-flight request is.
 */
export function isAppRouterRscRequest(request: NextRequest): boolean {
  return request.nextUrl.searchParams.has(NEXT_RSC_UNION_QUERY);
}

/**
 * Detecteert App Router "flight"-requests (RSC-payload), exclusief API en Next internals.
 *
 * @param parts - Genormaliseerd pad en flight-markers.
 * @returns Of dit een client-initiated RSC-fetch lijkt die `next-router-state-tree` kan dragen.
 */
export function isNextAppRouterFlightFetch(parts: FlightRequestParts): boolean {
  const { pathname, hasRscQuery, rscHeader } = parts;
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next")) {
    return false;
  }
  return hasRscQuery || rscHeader === "1";
}

/**
 * Next.js 16.2+ kan een 500 gooien wanneer een oude client na een deploy een verouderd
 * `next-router-state-tree` stuurt. De header weglaten komt overeen met upstream-fallback.
 *
 * @param parts - Genormaliseerd pad en flight-markers.
 * @returns Of middleware `next-router-state-tree` moet verwijderen voordat de App Router draait.
 */
export function shouldDropStaleFlightRouterStateTree(
  parts: FlightRequestParts,
): boolean {
  return isNextAppRouterFlightFetch(parts);
}

/**
 * Leest flight-markers uit een {@link NextRequest} voor gebruik in middleware.
 *
 * @param request - Het binnenkomende verzoek.
 * @returns Pad en flight-markers.
 */
export function flightRequestPartsFromNextRequest(
  request: NextRequest,
): FlightRequestParts {
  return {
    pathname: request.nextUrl.pathname,
    hasRscQuery: request.nextUrl.searchParams.has(NEXT_RSC_UNION_QUERY),
    rscHeader: request.headers.get(NEXT_RSC_HEADER),
  };
}
