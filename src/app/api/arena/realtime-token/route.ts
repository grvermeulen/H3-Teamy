import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import * as Ably from "ably";
import { getActiveUser } from "../../../../lib/activeUser";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "../../../../lib/dbUnavailableError";
import { RealtimeTokenResponseSchema } from "../../../../lib/schemas/arena";

export const runtime = "nodejs";

/** One hour, matching spec §6.2; the client refreshes through its authCallback. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * What a member may do: everything inside a room, read-only in the lobby (spec §6.2).
 * Scoping publish to `arena:room:*` is what stops a member from forging lobby presence.
 */
const ARENA_CAPABILITY: Record<string, Ably.capabilityOp[]> = {
  "arena:room:*": ["publish", "subscribe", "presence"],
  "arena:lobby": ["subscribe", "presence"],
};

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

    let tokenRequest;
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
      displayName: userId,
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
