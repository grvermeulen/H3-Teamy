import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import * as Ably from "ably";
import { z } from "zod";
import { authorizeArenaRequest } from "@/lib/arenaAuth";
import {
  isDbUnavailableError,
  jsonDatabaseUnavailable,
} from "@/lib/dbUnavailableError";
import { ARENA_LIMITS, checkRateLimit, rateLimited } from "@/lib/rateLimit";
import { RealtimeTokenResponseSchema } from "@/lib/schemas/arena";
import { ROOM_RULES } from "@/lib/cityArena/net/roomProtocol";
import {
  ArenaRoomError,
  arenaTokenCapability,
  authorizeArenaToken,
} from "@/lib/services/arenaRoomService";

export const runtime = "nodejs";

/** Issues an account-bound token for one approved room and its current host epoch. */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const user = await authorizeArenaRequest(req);
    if (user instanceof Response) return user;
    const verdict = await checkRateLimit(ARENA_LIMITS.token, user.userId);
    if (!verdict.allowed) return rateLimited(verdict);
    const memberId = z
      .uuid()
      .safeParse(req.nextUrl.searchParams.get("memberId"));
    if (!memberId.success)
      return NextResponse.json(
        { error: "Kies eerst een potje" },
        { status: 400 },
      );
    const ticket = await authorizeArenaToken(user.userId, memberId.data);
    const key = process.env.ABLY_API_KEY;
    if (!key)
      return NextResponse.json(
        { error: "Kon geen verbinding maken, probeer het later opnieuw" },
        { status: 503 },
      );
    const tokenRequest = await new Ably.Rest({ key }).auth.createTokenRequest({
      clientId: ticket.memberId,
      ttl: ROOM_RULES.tokenTtlMs,
      capability: arenaTokenCapability(ticket),
    });
    const payload = RealtimeTokenResponseSchema.parse({
      tokenRequest,
      clientId: ticket.memberId,
      displayName: user.displayName,
      ticket,
    });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    if (error instanceof ArenaRoomError)
      return NextResponse.json(
        { error: error.message, reason: error.reason },
        { status: error.status },
      );
    if (isDbUnavailableError(error)) return jsonDatabaseUnavailable();
    Sentry.captureException(error, {
      tags: { area: "arena", kind: "realtime-token" },
    });
    return NextResponse.json(
      { error: "Kon geen verbinding maken, probeer het later opnieuw" },
      { status: 502 },
    );
  }
}
