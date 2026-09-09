import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import * as Ably from "ably";
import { getActiveUser } from "../../../../lib/activeUser";
import { prisma } from "../../../../lib/db";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "../../../../lib/dbUnavailableError";
import {
  ARENA_LIMITS,
  checkRateLimit,
  rateLimited,
} from "../../../../lib/rateLimit";
import { RealtimeTokenResponseSchema } from "../../../../lib/schemas/arena";

export const runtime = "nodejs";

/** One hour, matching spec §6.2; the client refreshes through its authCallback. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * What a member may do: everything inside a room; subscribe and presence in the lobby (spec §6.2).
 *
 * Withholding `publish` on the lobby is not what stops a forged advertisement — hosts advertise
 * through presence, so every member can enter presence there with a made-up `room`. What stops
 * it is `GET /api/arena/rooms`, which checks each advertised room against the room channel's own
 * presence set and drops any whose advertiser is not that room's elected host.
 */
const ARENA_CAPABILITY: Record<string, Ably.capabilityOp[]> = {
  "arena:room:*": ["publish", "subscribe", "presence"],
  "arena:lobby": ["subscribe", "presence"],
};

/** Shown to the rest of the crew when a player has no first name on their account. */
const FALLBACK_NAME = "Speler";

/**
 * The player's first name, which is what the crew manifest shows.
 *
 * Only the first name: a scorebord and a crew list are read at a glance, and a full name pushes
 * everyone else's off a phone screen. A player with no name on their account still gets a label
 * rather than an empty tile.
 *
 * @param userId - The signed-in user.
 * @returns Their first name, or a fallback.
 */
async function displayNameFor(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true },
  });
  const first = user?.firstName?.trim() ?? "";
  return first.length > 0 ? first : FALLBACK_NAME;
}

/**
 * GET — geeft een ondertekend Ably-tokenverzoek voor de speler in deze sessie.
 *
 * The API key never leaves the server: the browser receives a short-lived token request it
 * exchanges with Ably itself. `clientId` is the user id, which is what fixes identity in presence
 * and therefore who may host (spec §6.6).
 *
 * @param req - The incoming request, carrying the session.
 * @returns The token request, or an error response.
 */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const { userId } = await getActiveUser(req);
    const verdict = await checkRateLimit(ARENA_LIMITS.token, userId);
    if (!verdict.allowed) return rateLimited(verdict);
    const key = process.env.ABLY_API_KEY;
    if (!key) {
      Sentry.captureException(new Error("ABLY_API_KEY is not set"), {
        tags: { area: "arena", kind: "realtime-token" },
      });
      return NextResponse.json(
        { error: "Kon geen verbinding maken, probeer het later opnieuw" },
        { status: 503 },
      );
    }

    let tokenRequest: Ably.TokenRequest;
    try {
      tokenRequest = await new Ably.Rest({ key }).auth.createTokenRequest({
        clientId: userId,
        ttl: TOKEN_TTL_MS,
        capability: ARENA_CAPABILITY,
      });
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { area: "arena", kind: "realtime-token" },
      });
      return NextResponse.json(
        { error: "Kon geen verbinding maken, probeer het later opnieuw" },
        { status: 502 },
      );
    }

    const payload = RealtimeTokenResponseSchema.safeParse({
      tokenRequest,
      clientId: userId,
      displayName: await displayNameFor(userId),
    });
    if (!payload.success) {
      Sentry.captureException(
        new Error("Ably token request has an unexpected shape"),
        { tags: { area: "arena", kind: "realtime-token" } },
      );
      return NextResponse.json(
        { error: "Kon geen verbinding maken, probeer het later opnieuw" },
        { status: 502 },
      );
    }
    return NextResponse.json(payload.data);
  } catch (error: unknown) {
    if (isDbUnavailableError(error)) return jsonDatabaseUnavailable();
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "realtime-token" },
    });
    return NextResponse.json({ error: "Er ging iets mis" }, { status: 500 });
  }
}
