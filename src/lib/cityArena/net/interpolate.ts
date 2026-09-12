/**
 * Where remote entities are drawn (spec §6.5).
 *
 * A client renders everyone else at `serverNow − 120 ms`, which is far enough behind the host that
 * two snapshots almost always bracket the moment being drawn, so remote players move smoothly
 * instead of teleporting ten times a second. When snapshots stop arriving it extrapolates for at
 * most 100 ms and then freezes: a frozen player reads as lag, an extrapolated one that keeps
 * walking through a wall reads as a bug.
 */

import type { SnapshotPlayer } from "./snapshotWire";

/** Remote entities render this far behind server time (spec §6.5). */
export const INTERPOLATION_DELAY_MS = 120;
/** Beyond this the client stops extrapolating and freezes the entity. */
export const MAX_EXTRAPOLATION_MS = 100;

/** One snapshot's worth of remote positions, with the host time it described. */
export type SnapshotFrame = {
  serverTimeMs: number;
  players: SnapshotPlayer[];
};

/** Where one entity is drawn this frame. */
export type InterpolatedPose = { x: number; y: number; facing: number };

/** A whole turn in radians. */
const TURN_RAD = Math.PI * 2;

/** The shortest signed way round from `from` to `to`. */
function angleDelta(from: number, to: number): number {
  const raw = (to - from) % TURN_RAD;
  if (raw > Math.PI) return raw - TURN_RAD;
  if (raw < -Math.PI) return raw + TURN_RAD;
  return raw;
}

/** Blends two poses; `t` below 0 or above 1 extrapolates along the same line. */
function blend(
  first: SnapshotPlayer,
  second: SnapshotPlayer,
  t: number,
): InterpolatedPose {
  return {
    x: first.x + (second.x - first.x) * t,
    y: first.y + (second.y - first.y) * t,
    facing: first.facing + angleDelta(first.facing, second.facing) * t,
  };
}

/** The two frames bracketing `atMs`, or the nearest pair when it falls outside the buffer. */
function bracket(
  frames: SnapshotFrame[],
  atMs: number,
): { first: SnapshotFrame; second: SnapshotFrame; t: number } | null {
  if (frames.length === 0) return null;
  if (frames.length === 1) {
    const only = frames[0]!;
    return { first: only, second: only, t: 0 };
  }
  for (let index = 0; index < frames.length - 1; index += 1) {
    const first = frames[index]!;
    const second = frames[index + 1]!;
    if (atMs >= first.serverTimeMs && atMs <= second.serverTimeMs) {
      const span = second.serverTimeMs - first.serverTimeMs;
      return {
        first,
        second,
        t: span === 0 ? 0 : (atMs - first.serverTimeMs) / span,
      };
    }
  }
  const oldest = frames[0]!;
  if (atMs < oldest.serverTimeMs)
    return { first: oldest, second: oldest, t: 0 };
  // Past the newest frame: extrapolate from the last pair, capped so a starved client freezes.
  const last = frames[frames.length - 1]!;
  const previous = frames[frames.length - 2]!;
  const span = last.serverTimeMs - previous.serverTimeMs;
  if (span <= 0) return { first: last, second: last, t: 0 };
  const ahead = Math.min(atMs - last.serverTimeMs, MAX_EXTRAPOLATION_MS);
  return { first: previous, second: last, t: 1 + ahead / span };
}

/**
 * Where each remote entity is drawn.
 *
 * @param frames - Snapshots in ascending server time; the caller keeps a short buffer.
 * @param renderTimeMs - The host time to draw, normally `serverNow − 120 ms`.
 * @returns A pose per player id present in the bracketing frames.
 */
export function interpolatePlayers(
  frames: SnapshotFrame[],
  renderTimeMs: number,
): Map<number, InterpolatedPose> {
  const poses = new Map<number, InterpolatedPose>();
  const pair = bracket(frames, renderTimeMs);
  if (!pair) return poses;
  const second = new Map(pair.second.players.map((row) => [row.id, row]));
  for (const player of pair.first.players) {
    const later = second.get(player.id);
    poses.set(
      player.id,
      later
        ? blend(player, later, pair.t)
        : {
            x: player.x,
            y: player.y,
            facing: player.facing,
          },
    );
  }
  // A player who appears only in the newer frame has just joined; draw them where they are.
  for (const player of pair.second.players)
    if (!poses.has(player.id))
      poses.set(player.id, {
        x: player.x,
        y: player.y,
        facing: player.facing,
      });
  return poses;
}
