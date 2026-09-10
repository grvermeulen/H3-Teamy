/**
 * Who hosts a room, as the server sees it (spec §6.6, amended 2026-09-10).
 *
 * The server has no silence watch, and an old host's presence entry outlives its tab by up to
 * minutes, so presence alone names the wrong host right after a migration — the rooms list would
 * hide the room and a result posted by the new host would be refused. What the server does have
 * is the room channel's history: a host is someone you hear from, which is the rule the clients
 * already live by. This module reads both through Ably's REST API.
 */

import type * as Ably from "ably";
import { actingHost, type SnapshotSighting } from "./election";
import { roomChannelName } from "./room";
import type { PresenceMember } from "./transport";

/** The slice of an Ably REST client this module reads through; a fake in tests. */
export type RoomRest = Pick<Ably.Rest, "channels">;

/** How many of the newest messages to look through for the latest snapshot. */
const HISTORY_PAGE = 5;
/** The message name the host loop publishes snapshots under. */
const SNAPSHOT_MESSAGE = "state";

/**
 * A channel's presence set.
 *
 * @param rest - The REST client.
 * @param channel - The channel name.
 * @returns Everyone present, as the election reads them.
 */
export async function presenceOf(
  rest: RoomRest,
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
 * Who published the channel's newest snapshot, and when.
 *
 * @param rest - The REST client.
 * @param channel - The room channel name.
 * @returns The sighting, or `null` when no recent message is a snapshot with a publisher.
 */
export async function latestSnapshotOf(
  rest: RoomRest,
  channel: string,
): Promise<SnapshotSighting | null> {
  const page = await rest.channels
    .get(channel)
    .history({ limit: HISTORY_PAGE, direction: "backwards" });
  for (const item of page.items) {
    if (item.name !== SNAPSHOT_MESSAGE) continue;
    if (typeof item.clientId !== "string" || typeof item.timestamp !== "number")
      return null;
    return { clientId: item.clientId, timestamp: item.timestamp };
  }
  return null;
}

/** A room's host as the server sees it, with the presence set the answer came from. */
export type RoomHost = { host: string | null; members: PresenceMember[] };

/**
 * The acting host of a room: the latest recent snapshot's publisher when present, else the
 * presence election.
 *
 * @param rest - The REST client.
 * @param roomCode - The room.
 * @param nowMs - The clock to judge freshness by; the wall clock unless a test says otherwise.
 * @returns The host and the members.
 */
export async function resolveRoomHost(
  rest: RoomRest,
  roomCode: string,
  nowMs: number = Date.now(),
): Promise<RoomHost> {
  const channel = roomChannelName(roomCode);
  const [members, latest] = await Promise.all([
    presenceOf(rest, channel),
    latestSnapshotOf(rest, channel),
  ]);
  return { host: actingHost(members, latest, nowMs), members };
}
