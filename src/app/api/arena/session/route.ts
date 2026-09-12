import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { authorizeArenaRequest } from "@/lib/arenaAuth";
import { ArenaRoomCommandSchema } from "@/lib/cityArena/net/roomProtocol";
import { ARENA_LIMITS, checkRateLimit, rateLimited } from "@/lib/rateLimit";
import {
  ArenaRoomError,
  commandArenaRoom,
} from "@/lib/services/arenaRoomService";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "@/lib/dbUnavailableError";

/** Executes authenticated membership, heartbeat and match-start commands. */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const user = await authorizeArenaRequest(req);
    if (user instanceof Response) return user;
    const parsed = ArenaRoomCommandSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
    if (parsed.data.action === "create" || parsed.data.action === "join") {
      const limit = await checkRateLimit(ARENA_LIMITS.join, user.userId);
      if (!limit.allowed) return rateLimited(limit);
    }
    const ticket = await commandArenaRoom(user, parsed.data);
    return NextResponse.json(
      { ticket },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
    if (error instanceof ArenaRoomError)
      return NextResponse.json(
        { error: error.message, reason: error.reason },
        { status: error.status },
      );
    if (isDbUnavailableError(error)) return jsonDatabaseUnavailable();
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "session" },
    });
    return NextResponse.json(
      { error: "Het potje is even niet beschikbaar" },
      { status: 503 },
    );
  }
}
