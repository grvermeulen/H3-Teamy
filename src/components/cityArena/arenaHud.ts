import type { WorldSession } from "@/lib/cityArena/world/worldSession";
import type { MapZone, ZoneKey } from "@/lib/cityArena/world/mapTypes";
import {
  zoneCentreMetres,
  zoneRadiusMetres,
  findZone,
} from "@/lib/cityArena/world/zone";
import { nearestRoadName } from "@/lib/cityArena/world/nearestRoad";
import { currentWantedLevel } from "@/lib/cityArena/sim/wanted";
import { occupiedVehicle } from "@/lib/cityArena/sim/arena";
import { forwardSpeed } from "@/lib/cityArena/sim/vehicle";
import type {
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
};

/** Computes the current pure HUD projection. */
export function computeHud(
  session: Pick<WorldSession, "index" | "tiles">,
  state: ArenaState,
  soundEnabled = true,
): ArenaHud {
  const { player } = state;
  const zone = findZone(session.index(), [player.x, player.y]);
  const car = occupiedVehicle(state);
  const zoneSecondsLeft = zoneWarningSeconds(state);
  return {
    zoneName: zone?.name ?? null,
    zoneKey: zone?.key ?? null,
    street: nearestRoadName(session.tiles(), [player.x, player.y]),
    health: player.health,
    weapon: player.weapon,
    ammo: player.ammo,
    speedMps: car ? Math.abs(forwardSpeed(car)) : null,
    inVehicle: car !== null,
    wantedLevel: currentWantedLevel(state),
    zoneSecondsLeft,
    zoneWarning: state.zoneEnforced && zoneSecondsLeft !== null,
    soundEnabled,
  };
}

function zoneWarningSeconds(state: ArenaState): number | null {
  if (!state.zoneEnforced || state.player.outsideSinceTick === null)
    return null;
  return Math.max(
    0,
    Math.ceil((state.player.outsideSinceTick + 150 - state.tick) / 30),
  );
}

function withinRadar(
  point: [number, number],
  player: [number, number],
): boolean {
  return (
    Math.hypot(point[0] - player[0], point[1] - player[1]) <= RADAR_RANGE_M
  );
}

/** Builds the radar projection; optional road segments are supplied by the runtime world boundary. */
export function buildRadarSnapshot(
  state: ArenaState,
  zone: MapZone | null,
  roads: RadarSnapshot["roads"] = [],
): RadarSnapshot {
  const player: [number, number] = [state.player.x, state.player.y];
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
