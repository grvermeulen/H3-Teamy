import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import * as Ably from "ably";
import { electHost } from "../../../../lib/cityArena/net/election";
import {
  LOBBY_CHANNEL,
  roomsFromPresence,
  type LobbyRoom,
} from "../../../../lib/cityArena/net/lobbyPresence";
import { roomChannelName } from "../../../../lib/cityArena/net/room";
import type { PresenceMember } from "../../../../lib/cityArena/net/transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How long a browser may reuse this list.
 *
 * The launcher card sits on the home page, so this is read by every visitor. Reading the lobby
 * server-side and letting the browser hold it briefly keeps idle visitors off Ably entirely —
 * the free tier caps *concurrent connections*, and an idle home page must not spend them.
 */
const CACHE_SECONDS = 5;

/** The shape the launcher renders. */
type RoomsResponse = { rooms: LobbyRoom[] };

/** Reads one channel's presence set through Ably's REST API. */
async function presenceOf(
  rest: Ably.Rest,
  channel: string,
): Promise<PresenceMember[]> {
  const page = await rest.channels.get(channel).presence.get();
  return page.items.map((item) => ({
    clientId: item.clientId,
    data: item.data as PresenceMember["data"],
    timestamp: item.timestamp,
  }));
}

/**
 * Keeps only the rooms whose advertiser is really that room's elected host.
 *
 * Any member can enter lobby presence with a made-up `room`, because hosts advertise through
 * presence and the token cannot tell the two apart. This is the check that makes the list
 * trustworthy: the room channel's own presence set says who is in it, and the same election
 * every client runs says who hosts it.
 */
async function verifiedRooms(
  rest: Ably.Rest,
  lobby: PresenceMember[],
): Promise<LobbyRoom[]> {
  const advertiserByCode = new Map(
    lobby.map((member) => [
      (member.data as { room?: { roomCode?: string } } | undefined)?.room
        ?.roomCode,
      member.clientId,
    ]),
  );
  const rooms = roomsFromPresence(lobby);
  const checks = await Promise.all(
    rooms.map(async (room) => {
      const members = await presenceOf(rest, roomChannelName(room.roomCode));
      return electHost(members) === advertiserByCode.get(room.roomCode);
    }),
  );
  return rooms.filter((_, index) => checks[index]);
}

/** An empty list, which is what every failure returns: no potjes is a normal state, not an error. */
function noRooms(): NextResponse<RoomsResponse> {
  return NextResponse.json({ rooms: [] });
}

/**
 * GET — de actieve potjes, gelezen uit de lobby-presence van Ably.
 *
 * Failures answer with an empty list rather than an error status: the card's "geen actieve
 * potjes" state is the honest thing to show when the lobby cannot be read, and a red error on
 * the home page for a game nobody is playing would be worse than saying nothing is running.
 * The failure still reaches Sentry.
 *
 * @returns The rooms currently advertised, newest host per code.
 */
export async function GET(): Promise<Response> {
  const key = process.env.ABLY_API_KEY;
  if (!key) {
    Sentry.captureException(new Error("ABLY_API_KEY is not set"), {
      tags: { area: "arena", kind: "rooms" },
    });
    return noRooms();
  }

  try {
    const rest = new Ably.Rest({ key });
    const lobby = await presenceOf(rest, LOBBY_CHANNEL);
    const response = NextResponse.json<RoomsResponse>({
      rooms: await verifiedRooms(rest, lobby),
    });
    response.headers.set(
      "Cache-Control",
      `public, max-age=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`,
    );
    return response;
  } catch (error: unknown) {
    Sentry.captureException(error, { tags: { area: "arena", kind: "rooms" } });
    return noRooms();
  }
}
