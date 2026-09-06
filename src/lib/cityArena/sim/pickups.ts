import type { MapIndex, MapZone } from "../world/mapTypes";
import { fromUnits, type Point } from "../world/projection";
import type { RoadGraph } from "../world/roadGraph";
import { landmarkCentreMetres } from "../world/zone";
import { PLAYER_MAX_HEALTH, isDead } from "./damage";
import { pushEvent } from "./events";
import { playersOf, replacePlayer } from "./players";
import { farFromAll, shuffle } from "./spawn";
import type {
  ArenaPlayerState,
  ArenaState,
  PickupKind,
  PickupState,
} from "./types";
import { MAX_AMMO, addAmmo } from "./weapons";

/** Number of weapon pickup spots per zone. */
export const WEAPON_PICKUPS_PER_ZONE = 6;
/** Maximum weapon pickup spots sourced from landmarks. */
export const LANDMARK_WEAPON_PICKUPS = 4;
/** Number of health pickup spots per zone. */
export const HEALTH_PICKUPS_PER_ZONE = 4;
/** Distance within which a player takes a pickup. */
export const PICKUP_TAKE_RANGE_M = 1.2;
/** Ticks a taken pickup remains unavailable. */
export const PICKUP_RESPAWN_TICKS = 600;
/** Health restored by a health pickup. */
export const HEALTH_PICKUP_AMOUNT = 50;
/** Rounds granted by one magazine pickup. */
export const PICKUP_ROUNDS: Record<"uzi" | "shotgun", number> = {
  uzi: 60,
  shotgun: 8,
};
/** Minimum pickup distance from a fresh player spawn. */
export const MIN_PICKUP_TO_PLAYER_M = 8;
const LANDMARK_SNAP_M = 80;
const MIN_PICKUP_SPACING_M = 15;
const WEAPON_KINDS: PickupKind[] = ["uzi", "shotgun"];

/** Graph subset required for pickup placement. */
export type PickupGraph = Pick<RoadGraph, "nodes" | "nearestNode">;

/** Returns whether a pickup is currently available. */
export function isPickupActive(pickup: PickupState): boolean {
  return pickup.takenAtTick === null;
}

/** Returns whether taking the pickup would change the player's state. */
export function canTakePickup(
  player: ArenaPlayerState,
  pickup: PickupState,
): boolean {
  if (pickup.kind === "health") return player.health < PLAYER_MAX_HEALTH;
  return player.ammo[pickup.kind] < MAX_AMMO[pickup.kind];
}

/** Applies the pickup effect and arms a weapon when the player has no magazine weapon selected. */
export function applyPickupToPlayer(
  player: ArenaPlayerState,
  pickup: PickupState,
): ArenaPlayerState {
  if (pickup.kind === "health")
    return {
      ...player,
      health: Math.min(PLAYER_MAX_HEALTH, player.health + HEALTH_PICKUP_AMOUNT),
    };
  const ammo = addAmmo(player.ammo, pickup.kind, PICKUP_ROUNDS[pickup.kind]);
  const rearm = player.weapon === "fist" || player.weapon === "pistol";
  return { ...player, ammo, weapon: rearm ? pickup.kind : player.weapon };
}

function landmarkSpots(
  index: MapIndex,
  zone: MapZone,
  graph: PickupGraph,
): Point[] {
  const spots: Point[] = [];
  for (const key of zone.landmarks) {
    const landmark = index.landmarks.find((candidate) => candidate.key === key);
    if (!landmark) continue;
    const centre = landmarkCentreMetres(landmark);
    const node = graph.nearestNode(centre, LANDMARK_SNAP_M);
    spots.push(node === null ? centre : graph.nodes[node]);
  }
  return spots.slice(0, LANDMARK_WEAPON_PICKUPS);
}

function takeSpaced(
  candidates: Point[],
  placed: Point[],
  avoid: Point[],
  count: number,
): Point[] {
  const chosen: Point[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= count) break;
    if (!farFromAll(candidate, avoid, MIN_PICKUP_TO_PLAYER_M)) continue;
    if (!farFromAll(candidate, [...placed, ...chosen], MIN_PICKUP_SPACING_M))
      continue;
    chosen.push(candidate);
  }
  return chosen;
}

/** Places alternating weapon spots and health spots for one zone. */
export function placePickups(
  index: MapIndex,
  zone: MapZone,
  graph: PickupGraph,
  random: () => number,
  avoid: Point[],
  firstId: number,
): PickupState[] {
  const nodes = shuffle(
    zone.spawnNodes.map(([x, y]): Point => [fromUnits(x), fromUnits(y)]),
    random,
  );
  const landmarks = takeSpaced(
    landmarkSpots(index, zone, graph),
    [],
    avoid,
    LANDMARK_WEAPON_PICKUPS,
  );
  const weaponSpots = [
    ...landmarks,
    ...takeSpaced(
      nodes,
      landmarks,
      avoid,
      WEAPON_PICKUPS_PER_ZONE - landmarks.length,
    ),
  ];
  const healthSpots = takeSpaced(
    nodes,
    weaponSpots,
    avoid,
    HEALTH_PICKUPS_PER_ZONE,
  );
  const weapons: PickupState[] = weaponSpots.map((point, offset) => ({
    id: firstId + offset,
    kind: WEAPON_KINDS[offset % WEAPON_KINDS.length],
    x: point[0],
    y: point[1],
    takenAtTick: null,
  }));
  const health: PickupState[] = healthSpots.map((point, offset) => ({
    id: firstId + weapons.length + offset,
    kind: "health",
    x: point[0],
    y: point[1],
    takenAtTick: null,
  }));
  return [...weapons, ...health];
}

function respawnPickup(pickup: PickupState, tick: number): PickupState {
  if (
    pickup.takenAtTick === null ||
    tick - pickup.takenAtTick < PICKUP_RESPAWN_TICKS
  )
    return pickup;
  return { ...pickup, takenAtTick: null };
}

function findTaker(
  state: ArenaState,
  pickup: PickupState,
): ArenaPlayerState | null {
  for (const player of playersOf(state)) {
    if (isDead(player) || player.vehicleId !== null) continue;
    if (
      Math.hypot(player.x - pickup.x, player.y - pickup.y) > PICKUP_TAKE_RANGE_M
    )
      continue;
    if (canTakePickup(player, pickup)) return player;
  }
  return null;
}

/** Respawns due pickups and applies active pickups within reach. */
export function stepPickups(state: ArenaState, tick: number): ArenaState {
  let next = state;
  const pickups: PickupState[] = [];
  for (const pickup of state.pickups) {
    const fresh = respawnPickup(pickup, tick);
    const taker = isPickupActive(fresh) ? findTaker(next, fresh) : null;
    if (!taker) {
      pickups.push(fresh);
      continue;
    }
    next = replacePlayer(next, applyPickupToPlayer(taker, fresh));
    next = {
      ...next,
      events: pushEvent(next.events, {
        kind: "pickup",
        pickupKind: fresh.kind,
        playerId: taker.id,
        x: fresh.x,
        y: fresh.y,
      }),
    };
    pickups.push({ ...fresh, takenAtTick: tick });
  }
  return { ...next, pickups };
}
