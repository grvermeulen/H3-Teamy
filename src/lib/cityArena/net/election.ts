/**
 * Who hosts, and when to replace them (spec §6.6).
 *
 * Every member runs {@link electHost} independently over the same presence set and they must all
 * reach the same answer, so the comparison is a **total order**: role, then who was present first,
 * then client id. Falling through to array order would let two members disagree about who is
 * hosting, which shows up as a match that forks rather than as an error.
 */

import type { PresenceData, PresenceMember } from "./transport";

/** Silence after which the host is presumed gone and a re-election runs (spec §6.6). */
export const HOST_SILENCE_MS = 3000;

/**
 * Host priority by role: a display is a fixed screen and the best host, a desktop player is next,
 * then a phone, and a controller — which renders nothing — last.
 */
const ROLE_PRIORITY: Record<string, number> = {
  display: 0,
  "player:desktop": 1,
  "player:mobile": 2,
  controller: 3,
};

/** The priority of one member, lower being the better host. */
function priorityOf(member: PresenceMember): number {
  // Ably can deliver a member with no data at all. Election doubles as the authorisation check
  // in recordMatch, so a TypeError here would turn a bad presence entry into a 500.
  const data = member.data as Partial<PresenceData> | null | undefined;
  const role = data?.role;
  if (role === "player")
    return ROLE_PRIORITY[`player:${data?.device ?? "mobile"}`] ?? 2;
  // A member we know nothing about ranks strictly last: it must never out-rank anyone
  // identifiable, not even a controller, and never win a tie on having joined earlier.
  return role ? (ROLE_PRIORITY[role] ?? 3) : 4;
}

/**
 * The member who should host.
 *
 * @param members - Everyone present, in any order.
 * @returns The host's client id, or `null` when nobody is present.
 */
export function electHost(members: PresenceMember[]): string | null {
  return rankMembers(members)[0]?.clientId ?? null;
}

/**
 * Everyone present, best host first: the total order the election picks from.
 *
 * @param members - Everyone present, in any order.
 * @returns A sorted copy; the input is untouched.
 */
export function rankMembers(members: PresenceMember[]): PresenceMember[] {
  return [...members].sort((first, second) => {
    const byRole = priorityOf(first) - priorityOf(second);
    if (byRole !== 0) return byRole;
    const byTime = first.timestamp - second.timestamp;
    if (byTime !== 0) return byTime;
    return first.clientId < second.clientId ? -1 : 1;
  });
}

/** A snapshot this old still counts as hearing from its publisher; a migrated host publishes well within it. */
export const ACTING_HOST_FRESH_MS = 10_000;

/** Who published a snapshot, and when the server received it. */
export type SnapshotSighting = { clientId: string; timestamp: number };

/**
 * The member actually hosting: the best-ranked present member with a fresh snapshot, else the
 * plain election.
 *
 * The server has no silence watch, and an old host's presence entry outlives its tab by up to
 * minutes; what it does have is the channel's history, and a host is someone you hear from — the
 * rule the clients live by (spec §6.6, amended 2026-09-10). Rank still decides between
 * publishers: a lower-ranked member is taken as host only while everyone above it is silent,
 * which is the same condition under which the clients' silence rule re-elects, so publishing
 * snapshots beside a living host gains nothing.
 *
 * @param members - Everyone present, in any order.
 * @param sightings - The newest snapshot seen from each publisher on the room channel.
 * @param nowMs - The clock to judge freshness by.
 * @param freshMs - How old a snapshot may be and still count.
 * @returns The host's client id, or `null` when nobody is present.
 */
export function actingHost(
  members: PresenceMember[],
  sightings: SnapshotSighting[],
  nowMs: number,
  freshMs: number = ACTING_HOST_FRESH_MS,
): string | null {
  const fresh = new Set(
    sightings
      .filter((sighting) => nowMs - sighting.timestamp <= freshMs)
      .map((sighting) => sighting.clientId),
  );
  const ranked = rankMembers(members);
  const heard = ranked.find((member) => fresh.has(member.clientId));
  return heard?.clientId ?? ranked[0]?.clientId ?? null;
}

/** How a host watch is configured. */
export type HostWatchOptions = {
  /** How long the host may be quiet before a re-election; defaults to {@link HOST_SILENCE_MS}. */
  silenceMs?: number;
};

/** Watches for a host that has stopped publishing. */
export type HostWatch = {
  /** Records that a snapshot arrived, which resets the window. */
  sawSnapshot(): void;
  /** Adds elapsed time. Passed in rather than read from a clock, so tests need no fake timers. */
  elapsed(ms: number): void;
  /** Whether the host has been quiet long enough to re-elect. */
  isSilent(): boolean;
};

/**
 * Creates a watch for host silence.
 *
 * A watch that has never seen a snapshot counts from its creation, so a room whose host never
 * publishes at all re-elects rather than waiting forever.
 *
 * @param options - An optional silence window.
 * @returns The watch, which the caller feeds with elapsed time.
 */
export function createHostWatch(options: HostWatchOptions = {}): HostWatch {
  const silenceMs = options.silenceMs ?? HOST_SILENCE_MS;
  let quietMs = 0;
  return {
    sawSnapshot(): void {
      quietMs = 0;
    },
    elapsed(ms: number): void {
      quietMs += ms;
    },
    isSilent(): boolean {
      return quietMs >= silenceMs;
    },
  };
}

/**
 * The member who should host, skipping anyone the caller has given up on.
 *
 * Presence alone cannot tell a host whose tab the browser throttled from one that is fine, so
 * the silence rule (spec §6.6) feeds in the ids it has stopped hearing from. They still count when
 * nobody else is left: a room hosted by the quiet beats a room with no host at all.
 *
 * @param members - Everyone present, in any order.
 * @param lost - Client ids the silence rule has given up on.
 * @returns The host's client id, or `null` when nobody is present.
 */
export function electPresentHost(
  members: PresenceMember[],
  lost: ReadonlySet<string>,
): string | null {
  const heard = members.filter((member) => !lost.has(member.clientId));
  return electHost(heard) ?? electHost(members);
}
