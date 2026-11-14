import { NextRequest, NextResponse } from "next/server";
import { getReport } from "../../../lib/kv";

/**
 * Geeft het opgeslagen wedstrijdverslag voor een event terug (publiek leesbaar).
 *
 * Verslagen worden alleen geschreven via `POST /api/report/generate`; deze
 * route heeft bewust geen `POST`-handler, zodat Next.js schrijfpogingen met
 * 405 beantwoordt.
 *
 * @param req - Request met query-parameter `eventId`.
 * @returns 200 met `{ report }` (of `{ report: null }`), 400 zonder `eventId`.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId)
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  const report = await getReport(eventId);
  return NextResponse.json({ report });
}
