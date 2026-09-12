import type { WorldSession } from "@/lib/cityArena/world/worldSession";
import type { MapZone, ZoneKey } from "@/lib/cityArena/world/mapTypes";
import {
  zoneCentreMetres,
  zoneRadiusMetres,
  findZone,
  findZoneByKey,
} from "@/lib/cityArena/world/zone";
import { nearestRoadName } from "@/lib/cityArena/world/nearestRoad";
import { currentWantedLevel } from "@/lib/cityArena/sim/wanted";
import { occupiedVehicle } from "@/lib/cityArena/sim/arena";
import { firesCannon, forwardSpeed } from "@/lib/cityArena/sim/vehicle";
import type {
  ArenaPlayerState,
  AmmoState,
  ArenaState,
  PickupKind,
  WeaponKind,
} from "@/lib/cityArena/sim/types";
import {
  RADAR_RANGE_M,
  type RadarSnapshot,
} from "@/lib/cityArena/render/radar";

/** Pure data consumed by the arena HUD. */
export type ArenaHud = {
  zoneName: string | null;
  zoneKey: ZoneKey | null;
  street: string | null;
  health: number;
  weapon: WeaponKind;
  ammo: AmmoState;
  speedMps: number | null;
  inVehicle: boolean;
  wantedLevel: number;
  zoneSecondsLeft: number | null;
  zoneWarning: boolean;
  soundEnabled: boolean;
  /** The station playing in the car, or `null` while the radio is silent. */
  radioStation: string | null;
};

/** Computes the current pure HUD projection. */
export function computeHud(
  session: Pick<WorldSession, "index" | "tiles">,
  state: ArenaState,
  player: ArenaPlayerState,
  soundEnabled = true,
  radioStation: string | null = null,
): ArenaHud {
  const zone = findZone(session.index(), [player.x, player.y]);
  const car = occupiedVehicle(state, player);
  const zoneSecondsLeft = zoneWarningSeconds(state, player);
  return {
    zoneName: zone?.name ?? null,
    zoneKey: zone?.key ?? null,
    street: nearestRoadName(session.tiles(), [player.x, player.y]),
    health: player.health,
    weapon: car && firesCannon(car.kind) ? "cannon" : player.weapon,
    ammo: player.ammo,
    speedMps: car ? Math.abs(forwardSpeed(car)) : null,
    inVehicle: car !== null,
    wantedLevel: currentWantedLevel(state),
    zoneSecondsLeft,
    zoneWarning: state.zoneEnforced && zoneSecondsLeft !== null,
    soundEnabled,
    radioStation,
  };
}

function zoneWarningSeconds(
  state: ArenaState,
  player: ArenaPlayerState,
): number | null {
  const outsideSinceTick = player.outsideSinceTick;
  if (!state.zoneEnforced || outsideSinceTick === null) return null;
  return Math.max(0, Math.ceil((outsideSinceTick + 150 - state.tick) / 30));
}

function withinRadar(
  point: [number, number],
  player: [number, number],
): boolean {
  return (
    Math.hypot(point[0] - player[0], point[1] - player[1]) <= RADAR_RANGE_M
  );
}

/** Resolves the ring the radar should show, preserving the selected enforcement zone. */
export function radarZone(
  index: Parameters<typeof findZone>[0],
  state: ArenaState,
  player: ArenaPlayerState,
): MapZone | null {
  if (!state.zoneEnforced) return findZone(index, [player.x, player.y]);
  const key = state.enforcedZoneKey ?? state.activeZoneKey;
  return key === null ? null : findZoneByKey(index, key);
}

/** Builds the radar projection; optional road segments are supplied by the runtime world boundary. */
export function buildRadarSnapshot(
  state: ArenaState,
  me: ArenaPlayerState,
  zone: MapZone | null,
  roads: RadarSnapshot["roads"] = [],
): RadarSnapshot {
  const player: [number, number] = [me.x, me.y];
  return {
    player,
    roads,
    pickups: state.pickups
      .filter(
        (pickup) =>
          pickup.takenAtTick === null &&
          withinRadar([pickup.x, pickup.y], player),
      )
      .map((pickup) => ({
        point: [pickup.x, pickup.y] as [number, number],
        kind: pickup.kind as PickupKind,
      })),
    police: [
      ...state.vehicles
        .filter(
          (vehicle) =>
            vehicle.kind === "police" &&
            withinRadar([vehicle.x, vehicle.y], player),
        )
        .map((vehicle) => [vehicle.x, vehicle.y] as [number, number]),
      ...state.cops
        .filter(
          (cop) =>
            cop.diedAtTick === null && withinRadar([cop.x, cop.y], player),
        )
        .map((cop) => [cop.x, cop.y] as [number, number]),
    ],
    tanks: state.vehicles
      .filter(
        (vehicle) =>
          firesCannon(vehicle.kind) &&
          !vehicle.wrecked &&
          withinRadar([vehicle.x, vehicle.y], player),
      )
      .map((vehicle) => [vehicle.x, vehicle.y] as [number, number]),
    zoneCentre: zone ? zoneCentreMetres(zone) : null,
    zoneRadiusM: zone ? zoneRadiusMetres(zone) : null,
  };
}

/** Dutch countdown text for the out-of-zone warning. */
export function zoneWarningText(secondsLeft: number | null): string | null {
  return secondsLeft === null
    ? null
    : `Terug naar het strijdgebied! ${secondsLeft}…`;
}
