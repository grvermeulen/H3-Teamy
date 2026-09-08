import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getActiveUser } from "../../../../lib/activeUser";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "../../../../lib/dbUnavailableError";
import { PostMatchSchema } from "../../../../lib/schemas/arena";
import {
  recordMatch,
  type RecordFailure,
} from "../../../../lib/services/arenaMatchService";

export const runtime = "nodejs";

/** What a refusal means, in Dutch and in HTTP. */
const REFUSALS: Record<RecordFailure, { status: number; error: string }> = {
  "not-host": {
    status: 403,
    error: "Alleen de host van dit potje kan de uitslag opsturen",
  },
  "too-few-players": {
    status: 422,
    error: "Uitslag wordt niet opgeslagen: te weinig spelers",
  },
  "no-eligible-players": {
    status: 422,
    error: "Uitslag wordt niet opgeslagen: te weinig spelers",
  },
  // Not an error: a retry after a dropped response lands here, and the potje is already safe.
  "already-recorded": { status: 200, error: "Uitslag was al opgeslagen" },
};

/**
 * POST — slaat de uitslag van een afgelopen potje op.
 *
 * Only the elected host of a live room may post, and only for players who were actually in it;
 * `arenaMatchService` states the trust model and does the checking.
 *
 * @param req - The request carrying the session and the potje.
 * @returns What was recorded, or why it was not.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { userId } = await getActiveUser(req);
    const key = process.env.ABLY_API_KEY;
    if (!key) {
      Sentry.captureException(new Error("ABLY_API_KEY is not set"), {
        tags: { area: "arena", kind: "match-record" },
      });
      return NextResponse.json({ error: "Er ging iets mis" }, { status: 503 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { area: "arena", kind: "match-record" },
      });
      return NextResponse.json({ error: "Ongeldige uitslag" }, { status: 400 });
    }

    const parsed = PostMatchSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: "Ongeldige uitslag" }, { status: 400 });

    const outcome = await recordMatch(key, userId, {
      roomCode: parsed.data.roomCode,
      zone: parsed.data.zone,
      startedAt: new Date(parsed.data.startedAt),
      endedAt: new Date(parsed.data.endedAt),
      results: parsed.data.results,
    });
    if (!outcome.ok) {
      const refusal = REFUSALS[outcome.reason];
      return NextResponse.json(
        { error: refusal.error, reason: outcome.reason },
        { status: refusal.status },
      );
    }
    return NextResponse.json({
      matchId: outcome.matchId,
      recorded: outcome.recorded,
    });
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) return jsonDatabaseUnavailable();
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "match-record" },
    });
    return NextResponse.json({ error: "Er ging iets mis" }, { status: 500 });
  }
}
