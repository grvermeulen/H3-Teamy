import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { guardArenaRequest } from "./arenaAuth";
import {
  ARENA_DISPLAY_COOKIE,
  arenaDisplayIdentity,
  type ArenaDisplayIdentity,
} from "./arenaDisplayIdentity";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "./dbUnavailableError";
import { ArenaRoomError } from "./services/arenaRoomService";

/** Checks screen API origin/rate limits and proves ownership without resolving an account. */
export async function authorizeArenaDisplayRequest(
  req: NextRequest,
): Promise<ArenaDisplayIdentity | Response> {
  const rejected = await guardArenaRequest(req);
  if (rejected) return rejected;
  const identity = arenaDisplayIdentity(
    req.cookies.get(ARENA_DISPLAY_COOKIE)?.value,
  );
  return (
    identity ??
    NextResponse.json(
      { error: "Verbind het scherm opnieuw met een code" },
      { status: 401 },
    )
  );
}

/** Expected screen refusals are Dutch responses; infrastructure failures are observable. */
export function arenaDisplayError(error: unknown): Response {
  if (error instanceof SyntaxError)
    return NextResponse.json({ error: "Ongeldig verzoek" }, { status: 400 });
  if (error instanceof ArenaRoomError)
    return NextResponse.json(
      { error: error.message, reason: error.reason },
      { status: error.status },
    );
  if (isDbUnavailableError(error)) return jsonDatabaseUnavailable();
  Sentry.captureException(error, {
    tags: { area: "arena", kind: "display-api" },
  });
  return NextResponse.json(
    { error: "Het scherm kan even niet verbinden" },
    { status: 503 },
  );
}
