import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  ARENA_LIMITS,
  checkRateLimit,
  clientAddress,
  rateLimited,
} from "@/lib/rateLimit";
import { listArenaRooms } from "@/lib/services/arenaRoomService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lists live, server-registered rooms; clients cannot advertise an invented room. */
export async function GET(req: NextRequest): Promise<Response> {
  const verdict = await checkRateLimit(ARENA_LIMITS.rooms, clientAddress(req));
  if (!verdict.allowed) return rateLimited(verdict);
  try {
    return NextResponse.json(
      { rooms: await listArenaRooms() },
      {
        headers: {
          "Cache-Control": "public, max-age=5, stale-while-revalidate=10",
        },
      },
    );
  } catch (error: unknown) {
    Sentry.captureException(error, { tags: { area: "arena", kind: "rooms" } });
    return NextResponse.json(
      { rooms: [], error: "Actieve potjes zijn even niet beschikbaar" },
      { status: 503 },
    );
  }
}
