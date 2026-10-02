/**
 * The bangs a networked client would otherwise never hear. Events and effects never cross the
 * wire (`snapshotApply.ts`), so a client that only adopts snapshots sees a rocket vanish without a
 * fireball, a car wreck without a blast, and a building fall without a sound or a shake. This
 * compares two consecutive snapshots and makes those up, on the client alone: an `explosion` event
 * and effect where an explosive round vanished or a car was wrecked, and a `collapse` event for
 * each building newly destroyed. The host and an offline game already emit the real ones and never
 * run this, so nobody hears a blast twice.
 */
import { polygonCentroid, type Rect } from "../mapBuild/geometry";
import { CAR_BLAST } from "../sim/blast";
import { addEffect } from "../sim/effects";
import { pushEvent } from "../sim/events";
import { playerById } from "../sim/players";
import { destroyedStructureIds } from "../sim/structures";
import type {
  ArenaEvent,
  ArenaState,
  EffectState,
  StructureState,
} from "../sim/types";
import { EXPLOSIVES } from "../sim/weapons";
import type { CollisionView } from "../world/collisionView";
import type { Point } from "../world/projection";

/**
 * The first id of the effects a client makes up; each next one counts down from it. The host's
 * entity ids count up from `FIRST_ENTITY_ID` and are never negative, so a made-up effect can never
 * share an id with anything a snapshot carries — the 3D view bursts each effect id exactly once.
 */
export const FIRST_CLIENT_EFFECT_ID = -1;

/**
 * How far around this client's player a collapse whose footprint it does not know is looked up in
 * the collision grid, metres: as far as a collapse is ever felt (`COLLAPSE_FEEL_RADIUS_M`) or
 * shakes the screen (`COLLAPSE_SHAKE_RADIUS_M`). One farther away could only have been heard.
 */
export const COLLAPSE_LOCATE_RADIUS_M = 60;

/** Where a blast went off and how far it reached, for the event and the effect. */
type Detonation = { x: number; y: number; radius: number };

/** What {@link snapshotFeedback} compares and where it looks. */
export type SnapshotFeedbackInput = {
  /** The client's world before the snapshot landed: the previous snapshot's rounds, cars, ruins. */
  before: ArenaState;
  /** The world after it: the new snapshot adopted (and any prediction replayed). */
  after: ArenaState;
  /** The whole city's collision grid, destroyed buildings included, to find a footprint by id. */
  collision: Pick<CollisionView, "query">;
  /** The player this client drives, around whom an unknown footprint is looked for. */
  playerId: number;
  /** The id the next made-up effect takes (see {@link FIRST_CLIENT_EFFECT_ID}). */
  nextEffectId: number;
};

/** The made-up events for the next tick, `after`'s effects with the fireballs added, and the next free id. */
export type SnapshotFeedback = {
  events: ArenaEvent[];
  effects: EffectState[];
  nextEffectId: number;
};

/** Rockets and shells in the previous snapshot and gone from this one: each detonated. */
function vanishedExplosives(
  before: ArenaState,
  after: ArenaState,
): Detonation[] {
  const flying = new Set(after.bullets.map((bullet) => bullet.id));
  const detonated: Detonation[] = [];
  for (const bullet of before.bullets) {
    const blast = EXPLOSIVES[bullet.weapon];
    if (!blast || flying.has(bullet.id)) continue;
    detonated.push({ x: bullet.x, y: bullet.y, radius: blast.entityRadius });
  }
  return detonated;
}

/** Cars intact in the previous snapshot and wrecked in this one: each exploded. */
function newlyWrecked(before: ArenaState, after: ArenaState): Detonation[] {
  const intact = new Set(
    before.vehicles.filter((car) => !car.wrecked).map((car) => car.id),
  );
  return after.vehicles
    .filter((car) => car.wrecked && intact.has(car.id))
    .map((car) => ({ x: car.x, y: car.y, radius: CAR_BLAST.entityRadius }));
}

/** Structures destroyed in this snapshot that were still standing (or untouched) in the last. */
function newlyDestroyed(
  before: ArenaState,
  after: ArenaState,
): StructureState[] {
  const fallen = destroyedStructureIds(before);
  return (after.structures ?? []).filter(
    (entry) => entry.destroyedAtTick !== null && !fallen.has(entry.id),
  );
}

/**
 * Where a newly destroyed structure stands: its own footprint centre when this client knew it
 * (a radius above 0), else the centre of its footprint in the collision grid within
 * {@link COLLAPSE_LOCATE_RADIUS_M} of this client's player, else `null`.
 */
function collapseSite(
  entry: StructureState,
  input: SnapshotFeedbackInput,
): Point | null {
  if (entry.radius > 0) return [entry.x, entry.y];
  const me = playerById(input.after, input.playerId);
  if (!me) return null;
  const around: Rect = {
    minX: me.x - COLLAPSE_LOCATE_RADIUS_M,
    minY: me.y - COLLAPSE_LOCATE_RADIUS_M,
    maxX: me.x + COLLAPSE_LOCATE_RADIUS_M,
    maxY: me.y + COLLAPSE_LOCATE_RADIUS_M,
  };
  const footprint = input.collision
    .query(around)
    .find((obstacle) => obstacle.structure?.id === entry.id);
  return footprint ? polygonCentroid(footprint.ring) : null;
}

/** `collapse` events for the buildings that fell since the last snapshot and could be placed. */
function collapseEvents(input: SnapshotFeedbackInput): ArenaEvent[] {
  let events: ArenaEvent[] = [];
  for (const entry of newlyDestroyed(input.before, input.after)) {
    const site = collapseSite(entry, input);
    if (!site) continue;
    events = pushEvent(events, {
      kind: "collapse",
      structureId: entry.id,
      x: site[0],
      y: site[1],
      killerId: null,
    });
  }
  return events;
}

/**
 * The explosions and collapses between two consecutive snapshots, as a client-only event list and
 * fireball effects (see the module comment). Pure and deterministic: the same two snapshots give
 * the same feedback. Bounded by the event and effect caps (`pushEvent`, `addEffect`).
 *
 * A collapse this client can place neither by its own footprint nor within
 * {@link COLLAPSE_LOCATE_RADIUS_M} of its player is left out: it is too far away to be felt or to
 * shake the screen, and a blast that brought it down has already been heard.
 *
 * @param input - The worlds either side of the snapshot, the collision grid and this client's seat.
 * @returns The events for the next tick, `after`'s effects plus a fireball per blast, and the next id.
 */
export function snapshotFeedback(
  input: SnapshotFeedbackInput,
): SnapshotFeedback {
  const { before, after } = input;
  let events: ArenaEvent[] = [];
  let effects = after.effects;
  let nextEffectId = input.nextEffectId;
  const blasts = [
    ...vanishedExplosives(before, after),
    ...newlyWrecked(before, after),
  ];
  for (const blast of blasts) {
    events = pushEvent(events, { kind: "explosion", x: blast.x, y: blast.y });
    effects = addEffect(effects, {
      id: nextEffectId,
      kind: "explosion",
      x: blast.x,
      y: blast.y,
      angle: 0,
      bornTick: after.tick,
      radius: blast.radius,
    });
    nextEffectId -= 1;
  }
  for (const event of collapseEvents(input)) events = pushEvent(events, event);
  return { events, effects, nextEffectId };
}

/** A client loop's made-up feedback between snapshots. */
export type FeedbackQueue = {
  /**
   * `next` with a fireball for every blast since `previous`, queueing the blasts' and collapses'
   * events for {@link FeedbackQueue.take}. The first call only notes that a snapshot has landed:
   * the world before it was this client's own, not the host's, so nothing can be compared yet.
   */
  fold(previous: ArenaState, next: ArenaState): ArenaState;
  /** The queued events, once — the next predicted tick hands them to sound, haptics and shake. */
  take(): ArenaEvent[];
};

/**
 * Starts the feedback for one client loop (see {@link snapshotFeedback}).
 *
 * @param collision - The city's collision grid, destroyed buildings included.
 * @param playerId - The player the client drives.
 * @returns The queue the loop folds every adopted snapshot through.
 */
export function createFeedbackQueue(
  collision: Pick<CollisionView, "query">,
  playerId: number,
): FeedbackQueue {
  let adopted = false;
  let pending: ArenaEvent[] = [];
  let nextEffectId = FIRST_CLIENT_EFFECT_ID;
  return {
    fold(previous, next) {
      if (!adopted) {
        adopted = true;
        return next;
      }
      const feedback = snapshotFeedback({
        before: previous,
        after: next,
        collision,
        playerId,
        nextEffectId,
      });
      nextEffectId = feedback.nextEffectId;
      for (const event of feedback.events) pending = pushEvent(pending, event);
      return { ...next, effects: feedback.effects };
    },
    take() {
      const events = pending;
      pending = [];
      return events;
    },
  };
}
