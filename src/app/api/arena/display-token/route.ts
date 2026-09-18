import { NextResponse, type NextRequest } from "next/server";
import * as Ably from "ably";
import { z } from "zod";
import { guardArenaRequest } from "@/lib/arenaAuth";
import {
  arenaDisplayError,
  authorizeArenaDisplayRequest,
} from "@/lib/arenaDisplayApi";
import {
  ARENA_DISPLAY_COOKIE,
  arenaDisplayIdentity,
  createArenaDisplayKey,
} from "@/lib/arenaDisplayIdentity";
import {
  ArenaRoomCodeSchema,
  ArenaRoomCommandSchema,
  ROOM_RULES,
  ARENA_PROTOCOL_VERSION,
} from "@/lib/cityArena/net/roomProtocol";
import {
  ARENA_LIMITS,
  checkRateLimit,
  clientAddress,
  rateLimited,
} from "@/lib/rateLimit";
import { RealtimeTokenResponseSchema } from "@/lib/schemas/arena";
import {
  arenaTokenCapability,
  authorizeArenaToken,
  commandArenaRoom,
} from "@/lib/services/arenaRoomService";

/** Creates or joins one anonymous screen membership; the cookie is never a player identity. */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const rejected = await guardArenaRequest(req);
    if (rejected) return rejected;
    if (req.headers.get("X-Arena-Protocol") !== String(ARENA_PROTOCOL_VERSION))
      return NextResponse.json(
        {
          error: "Het spel is bijgewerkt. Vernieuw de pagina om mee te spelen.",
          reason: "protocol-mismatch",
        },
        { status: 409 },
      );
    const limit = await checkRateLimit(ARENA_LIMITS.join, clientAddress(req));
    if (!limit.allowed) return rateLimited(limit);
    const body: unknown = await req.json();
    const short = z
      .object({ roomCode: ArenaRoomCodeSchema })
      .strict()
      .safeParse(body);
    const parsed = ArenaRoomCommandSchema.safeParse(
      short.success
        ? {
            action: "join",
            roomCode: short.data.roomCode,
            joinNonce: crypto.randomUUID(),
          }
        : body,
    );
    if (
      !parsed.success ||
      (parsed.data.action !== "join" && parsed.data.action !== "create")
    )
      return NextResponse.json(
        { error: "Kies een zone of voer een geldige code in" },
        { status: 400 },
      );
    const oldKey = req.cookies.get(ARENA_DISPLAY_COOKIE)?.value;
    const key = arenaDisplayIdentity(oldKey)
      ? oldKey!
      : createArenaDisplayKey();
    const identity = arenaDisplayIdentity(key)!;
    const ticket = await commandArenaRoom(
      { ...identity, userId: null, displayName: "Scherm" },
      parsed.data,
    );
    const response = NextResponse.json(
      { ticket },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(ARENA_DISPLAY_COOKIE, key, {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "strict",
      path: "/api/arena",
      maxAge: ROOM_RULES.roomTtlMs / 1000,
    });
    return response;
  } catch (error: unknown) {
    return arenaDisplayError(error);
  }
}

/** Renews, leaves or starts only the screen membership proved by the cookie. */
export async function PATCH(req: NextRequest): Promise<Response> {
  try {
    const identity = await authorizeArenaDisplayRequest(req);
    if (identity instanceof Response) return identity;
    const parsed = ArenaRoomCommandSchema.safeParse(await req.json());
    if (
      !parsed.success ||
      parsed.data.action === "create" ||
      parsed.data.action === "join"
    )
      return NextResponse.json(
        { error: "Ongeldig schermverzoek" },
        { status: 400 },
      );
    const ticket = await commandArenaRoom(
      { ...identity, userId: null, displayName: "Scherm" },
      parsed.data,
    );
    return NextResponse.json(
      { ticket },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    return arenaDisplayError(error);
  }
}

/** Grants only the current room epoch, with no player-input publication permission. */
export async function GET(req: NextRequest): Promise<Response> {
  try {
    const identity = await authorizeArenaDisplayRequest(req);
    if (identity instanceof Response) return identity;
    const limit = await checkRateLimit(
      ARENA_LIMITS.token,
      identity.displayKeyHash,
    );
    if (!limit.allowed) return rateLimited(limit);
    const parsed = z.uuid().safeParse(req.nextUrl.searchParams.get("memberId"));
    if (!parsed.success)
      return NextResponse.json(
        { error: "Kies eerst een potje" },
        { status: 400 },
      );
    const ticket = await authorizeArenaToken(identity, parsed.data);
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
      displayName: "Scherm",
      ticket,
    });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    return arenaDisplayError(error);
  }
}
