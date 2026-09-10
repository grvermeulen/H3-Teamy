/**
 * Who hosts a room, as the server sees it (spec §6.6, amended 2026-09-10).
 *
 * The server has no silence watch, and an old host's presence entry outlives its tab by up to
 * minutes, so presence alone names the wrong host right after a migration — the rooms list would
 * hide the room and a result posted by the new host would be refused. What the server does have
 * is the room channel's history: a host is someone you hear from, which is the rule the clients
 * already live by. Rank still decides between publishers (see `actingHost`), so a member cannot
 * talk itself into hosting by publishing beside a living host. This module reads presence and
 * history through Ably's REST API.
 */

import type * as Ably from "ably";
import {
  ACTING_HOST_FRESH_MS,
  actingHost,
  type SnapshotSighting,
} from "./election";
import { roomChannelName } from "./room";
import type { PresenceMember } from "./transport";

/** The slice of an Ably REST client this module reads through; a fake in tests. */
export type RoomRest = Pick<Ably.Rest, "channels">;

/** Messages per history page. At thirty snapshots a second, one page is over three seconds. */
const HISTORY_PAGE = 100;
/** Pages read at most: the window is covered long before this, and a busy channel cannot make the server page forever. */
const HISTORY_PAGES_MAX = 5;
/** The message name the host loop publishes snapshots under. */
const SNAPSHOT_MESSAGE = "state";

/** The fields of a history message the sightings read. */
type HistoryItem = { name?: string; clientId?: string; timestamp?: number };

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
 * Records a page's snapshots, newest first, one per publisher.
 *
 * @returns False once the page reached messages older than the window, so paging can stop.
 */
function collectSightings(
  items: HistoryItem[],
  sinceMs: number,
  newest: Map<string, number>,
): boolean {
  for (const item of items) {
    if (typeof item.timestamp !== "number") continue;
    if (item.timestamp < sinceMs) return false;
    if (item.name !== SNAPSHOT_MESSAGE || typeof item.clientId !== "string")
      continue;
    if (!newest.has(item.clientId)) newest.set(item.clientId, item.timestamp);
  }
  return true;
}

/**
 * The newest snapshot from each publisher within the window, paging back through the channel's
 * history until the messages are older than `sinceMs`. Every member may publish on the room
 * channel, so other messages are skipped rather than allowed to hide a snapshot behind them.
 *
 * @param rest - The REST client.
 * @param channel - The room channel name.
 * @param sinceMs - The oldest server timestamp that still counts.
 * @returns One sighting per publisher heard from within the window.
 */
export async function snapshotSightings(
  rest: RoomRest,
  channel: string,
  sinceMs: number,
): Promise<SnapshotSighting[]> {
  const newest = new Map<string, number>();
  let page = await rest.channels
    .get(channel)
    .history({ limit: HISTORY_PAGE, direction: "backwards" });
  for (let pages = 0; pages < HISTORY_PAGES_MAX; pages += 1) {
    if (!collectSightings(page.items, sinceMs, newest) || !page.hasNext())
      break;
    const next = await page.next();
    if (!next) break;
    page = next;
  }
  return [...newest].map(([clientId, timestamp]) => ({ clientId, timestamp }));
}

/** A room's host as the server sees it, with the presence set the answer came from. */
export type RoomHost = { host: string | null; members: PresenceMember[] };

/**
 * The acting host of a room: the best-ranked present member heard from within the window, else
 * the presence election.
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
  const [members, sightings] = await Promise.all([
    presenceOf(rest, channel),
    snapshotSightings(rest, channel, nowMs - ACTING_HOST_FRESH_MS),
  ]);
  return { host: actingHost(members, sightings, nowMs), members };
}
