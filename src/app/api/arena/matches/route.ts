import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { authorizeArenaRequest } from "@/lib/arenaAuth";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "@/lib/dbUnavailableError";
import { ARENA_LIMITS, checkRateLimit, rateLimited } from "@/lib/rateLimit";
import { PostMatchSchema } from "@/lib/schemas/arena";
import { recordMatch } from "@/lib/services/arenaMatchService";
import { ArenaRoomError } from "@/lib/services/arenaRoomService";

export const runtime = "nodejs";

/** Completes an authenticated, server-started round exactly once. */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const user = await authorizeArenaRequest(req);
    if (user instanceof Response) return user;
    const verdict = await checkRateLimit(ARENA_LIMITS.matches, user.userId);
    if (!verdict.allowed) return rateLimited(verdict);
    const parsed = PostMatchSchema.safeParse(await req.json());
    if (!parsed.success)
      return NextResponse.json({ error: "Ongeldige uitslag" }, { status: 400 });
    return NextResponse.json(await recordMatch(user.userId, parsed.data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Ongeldige uitslag" }, { status: 400 });
    if (error instanceof ArenaRoomError)
      return NextResponse.json(
        { error: error.message, reason: error.reason },
        { status: error.status },
      );
    if (isDbUnavailableError(error)) return jsonDatabaseUnavailable();
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "match-record" },
    });
    return NextResponse.json(
      { error: "De uitslag kon niet worden opgeslagen" },
      { status: 503 },
    );
  }
}
