import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "../../../../lib/dbUnavailableError";
import {
  LEADERBOARD_SIZE,
  leaderboard,
  type LeaderboardRow,
} from "../../../../lib/services/arenaMatchService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How long a browser may reuse the ranglijst; it changes only when a potje finishes. */
const CACHE_SECONDS = 30;

/** The shape the ranglijst renders. */
type LeaderboardResponse = { rows: LeaderboardRow[] };

/**
 * GET — de ranglijst: de beste spelers op overwinningen, dan kills.
 *
 * Public: the ranglijst is shown on the launcher card, which signed-out visitors can see.
 * It carries first names only, which is what the crew manifest already shows in play.
 *
 * @returns The top rows, or an empty list when they cannot be read.
 */
export async function GET(): Promise<Response> {
  try {
    const rows = await leaderboard(LEADERBOARD_SIZE);
    const response = NextResponse.json<LeaderboardResponse>({ rows });
    response.headers.set(
      "Cache-Control",
      `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`,
    );
    return response;
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) return jsonDatabaseUnavailable();
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "leaderboard" },
    });
    // An empty ranglijst is the honest thing to show; nobody can act on a database error here.
    return NextResponse.json<LeaderboardResponse>({ rows: [] });
  }
}
