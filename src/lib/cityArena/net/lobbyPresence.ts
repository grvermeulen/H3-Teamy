/**
 * The lobby: how a running match advertises itself, and how the launcher reads that list
 * (spec §6.3).
 *
 * Only the **host** of a room enters `arena:lobby` presence, carrying a summary of its room. Every
 * player's token grants `subscribe` and `presence` there but not `publish`, which is what stops
 * anyone forging a room into the list — proven against live Ably in `scripts/ably-live-check.mjs`.
 *
 * Presence data arrives from other clients, so it is untrusted: every entry is parsed with Zod and
 * a malformed one is dropped rather than rendered.
 */

import { z } from "zod";
import type { ZoneKey } from "../world/mapTypes";
import { isRoomCode } from "./room";
import type {
  LobbyRoomSummary,
  PresenceData,
  PresenceMember,
  RealtimeTransport,
} from "./transport";

/** The channel every room advertises itself on. */
export const LOBBY_CHANNEL = "arena:lobby";

/**
 * How often the host refreshes its lobby entry (spec §6.3).
 *
 * Presence already survives without it; the refresh is what keeps `players` and `phase` current
 * for someone staring at the launcher.
 */
export const LOBBY_REFRESH_MS = 5000;

/** The zones a room can be played in. */
const ZoneKeySchema = z.enum(["rhenen", "wageningen", "campus", "bennekom"]);

/** One room as it appears in the lobby, before we trust it. */
const LobbyRoomSchema = z.object({
  roomCode: z.string().refine(isRoomCode, { message: "not a room code" }),
  zone: ZoneKeySchema,
  players: z.number().int().min(0).max(64),
  phase: z.enum(["lobby", "playing"]),
});

/** A room in the launcher's "Actieve potjes" list. */
export type LobbyRoom = {
  roomCode: string;
  zone: ZoneKey;
  hostName: string;
  players: number;
  phase: "lobby" | "playing";
};

/**
 * Turns one lobby presence member into a room, or `null` when it is not one.
 *
 * @param member - A presence member from `arena:lobby`.
 * @returns The room it advertises, or `null` when the entry is malformed or carries no room.
 */
export function parseLobbyRoom(member: PresenceMember): LobbyRoom | null {
  const data = member.data as PresenceData | undefined;
  const parsed = LobbyRoomSchema.safeParse(data?.room);
  if (!parsed.success) return null;
  const name = typeof data?.name === "string" ? data.name.trim() : "";
  return {
    roomCode: parsed.data.roomCode,
    zone: parsed.data.zone,
    hostName: name.length > 0 ? name : "Onbekend",
    players: parsed.data.players,
    phase: parsed.data.phase,
  };
}

/**
 * Every valid room in a lobby presence set, newest host first.
 *
 * Two hosts advertising the same code should not happen, but a migration mid-refresh can produce
 * it briefly; the later entry wins, because that is the host that is actually publishing now.
 *
 * @param members - The lobby presence set.
 * @returns One room per code.
 */
export function roomsFromPresence(members: PresenceMember[]): LobbyRoom[] {
  const byCode = new Map<string, LobbyRoom>();
  for (const member of [...members].sort(
    (first, second) => first.timestamp - second.timestamp,
  )) {
    const room = parseLobbyRoom(member);
    if (room) byCode.set(room.roomCode, room);
  }
  return [...byCode.values()];
}

/** What the host announces about the room it is running. */
export type LobbyAdvertisement = {
  host: PresenceData;
  room: LobbyRoomSummary;
};

/**
 * Announces this host's room in the lobby.
 *
 * @param transport - The host's connection.
 * @param advertisement - Who is hosting, and the room summary to show.
 */
export async function enterLobby(
  transport: RealtimeTransport,
  advertisement: LobbyAdvertisement,
): Promise<void> {
  await transport.channel(LOBBY_CHANNEL).presence.enter({
    ...advertisement.host,
    room: advertisement.room,
  });
}

/**
 * Refreshes this host's lobby entry after the player count or phase changed.
 *
 * @param transport - The host's connection.
 * @param advertisement - The updated summary.
 */
export async function updateLobby(
  transport: RealtimeTransport,
  advertisement: LobbyAdvertisement,
): Promise<void> {
  await transport.channel(LOBBY_CHANNEL).presence.update({
    ...advertisement.host,
    room: advertisement.room,
  });
}

/**
 * Removes this host's room from the lobby.
 *
 * @param transport - The host's connection.
 */
export async function leaveLobby(transport: RealtimeTransport): Promise<void> {
  await transport.channel(LOBBY_CHANNEL).presence.leave();
}

/**
 * The rooms currently advertised in the lobby.
 *
 * @param transport - Any connection; reading the lobby needs no special capability.
 * @returns One room per code.
 */
export async function listLobbyRooms(
  transport: RealtimeTransport,
): Promise<LobbyRoom[]> {
  return roomsFromPresence(
    await transport.channel(LOBBY_CHANNEL).presence.get(),
  );
}
