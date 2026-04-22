import type { NextRequest } from "next/server";

/**
 * Detecteert App Router RSC-flight requests (`?_rsc=...`).
 * Deze verzoeken mogen geen aangepaste middleware doorlopen: een te brede matcher
 * corroleert met bekende Next.js-fouten rond parsen van de router-state header
 * (zie o.a. vercel/next.js#91723).
 *
 * @param request - Binnenkomend NextRequest (inclusief querystring).
 * @returns `true` wanneer het een RSC-flight request is.
 */
export function isAppRouterRscRequest(request: NextRequest): boolean {
  return request.nextUrl.searchParams.has("_rsc");
}
