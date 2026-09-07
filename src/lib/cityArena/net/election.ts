/**
 * Who hosts, and when to replace them (spec §6.6).
 *
 * Every member runs {@link electHost} independently over the same presence set and they must all
 * reach the same answer, so the comparison is a **total order**: role, then who was present first,
 * then client id. Falling through to array order would let two members disagree about who is
 * hosting, which shows up as a match that forks rather than as an error.
 */

import type { PresenceMember } from "./transport";

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
  const { role, device } = member.data;
  if (role === "player") return ROLE_PRIORITY[`player:${device}`] ?? 2;
  return ROLE_PRIORITY[role] ?? 3;
}

/**
 * The member who should host.
 *
 * @param members - Everyone present, in any order.
 * @returns The host's client id, or `null` when nobody is present.
 */
export function electHost(members: PresenceMember[]): string | null {
  if (members.length === 0) return null;
  const sorted = [...members].sort((first, second) => {
    const byRole = priorityOf(first) - priorityOf(second);
    if (byRole !== 0) return byRole;
    const byTime = first.timestamp - second.timestamp;
    if (byTime !== 0) return byTime;
    return first.clientId < second.clientId ? -1 : 1;
  });
  return sorted[0]?.clientId ?? null;
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
