/**
 * Smoke from cars that have taken a beating (spec §6.7: "wrecks go charred black and smoke"): a
 * wreck pours a thick dark column with the odd ember, a badly damaged car leaks thin grey smoke from
 * its bonnet. Each vehicle puffs at a fixed rate whatever the frame rate, only near the camera, and
 * never takes more than a share of the smoke pool, so a street of wrecks cannot starve a blast.
 */
import { createRng } from "../sim/rng";
import type { VehicleState } from "../sim/types";
import { lengthOf, smokeHealthOf } from "../sim/vehicle";
import { emitPuff, type Emitter, type PuffSpec, type Rng } from "./fxEmit";
import type { ParticleSystem } from "./particles";
import { vehicleHeight } from "./vehicleModels";

/** Vehicles farther than this from the camera focus do not smoke, metres. */
export const VEHICLE_SMOKE_RANGE_M = 120;
/** Seconds between two puffs of a wreck's column. */
export const WRECK_SMOKE_INTERVAL_S = 0.1;
/** Seconds between two embers from a wreck. */
const WRECK_EMBER_INTERVAL_S = 0.3;
/** Seconds between two puffs from a damaged bonnet. */
const DAMAGED_SMOKE_INTERVAL_S = 0.18;
/** Most of the smoke pool that vehicle smoke may fill; the rest stays free for blasts and dust. */
const AMBIENT_SMOKE_SHARE = 0.5;
/** How far ahead of the centre the bonnet vents, as a share of the body's length. */
const BONNET_SHARE = 0.35;
/** Heights the smoke leaves at, as a share of the vehicle's height. */
const WRECK_VENT_HEIGHT_SHARE = 0.9;
const BONNET_HEIGHT_SHARE = 0.65;
/** Seed of the smoke's jitter. */
const VEHICLE_SMOKE_SEED = 0x5e0c;

/** A thick, dark, slow-climbing column above a burnt-out car. */
const WRECK_SMOKE: PuffSpec = {
  scatter: 0.6,
  lift: [0, 0.2],
  outward: [0, 0.3],
  rise: [1.6, 2.4],
  life: [3, 4],
  size: [1.2, 1.8],
  colours: [0x1c1a18, 0x24211e, 0x2e2a26],
  gravity: -0.35,
  drag: 0.5,
};

/** Glowing flecks drifting up out of a wreck. */
const WRECK_EMBER: PuffSpec = {
  scatter: 0.9,
  lift: [0, 0.3],
  outward: [0, 0.6],
  rise: [2, 3.2],
  life: [0.9, 1.4],
  size: [0.1, 0.16],
  colours: [0xff6a1f, 0xff8c32],
  gravity: -0.2,
  drag: 0.8,
};

/** Thin grey wisps leaking from a damaged bonnet. */
const BONNET_SMOKE: PuffSpec = {
  scatter: 0.2,
  lift: [0, 0.1],
  outward: [0, 0.2],
  rise: [0.9, 1.3],
  life: [1.6, 2.2],
  size: [0.45, 0.65],
  colours: [0x8f8f8a, 0x9d9d98, 0x7e7e7a],
  gravity: -0.2,
  drag: 0.6,
};

/** When a vehicle may next puff, and the frame it was last seen in. */
type Vent = { nextSmoke: number; nextEmber: number; seenFrame: number };

/** Smoke from the scene's wrecks and damaged cars. */
export type VehicleSmoke = {
  /**
   * Puffs from every smoking vehicle near the focus that is due.
   *
   * @param vehicles - The scene's vehicles.
   * @param focus - The camera focus in world metres; `null` smokes every vehicle.
   * @param clock - Seconds since the effects started; paces each vehicle's puffs.
   */
  sync(
    vehicles: readonly VehicleState[],
    focus: { x: number; y: number } | null,
    clock: number,
  ): void;
};

function smokes(vehicle: VehicleState): boolean {
  return vehicle.wrecked || vehicle.health < smokeHealthOf(vehicle.kind);
}

function withinRange(
  vehicle: VehicleState,
  focus: { x: number; y: number } | null,
): boolean {
  if (!focus) return true;
  return (
    Math.hypot(vehicle.x - focus.x, vehicle.y - focus.y) <=
    VEHICLE_SMOKE_RANGE_M
  );
}

/** Where a wreck's smoke leaves: above its middle. */
function wreckVent(vehicle: VehicleState): Emitter {
  return {
    x: vehicle.x,
    y: vehicleHeight(vehicle.kind) * WRECK_VENT_HEIGHT_SHARE,
    z: vehicle.y,
  };
}

/** Where a damaged car's smoke leaves: its bonnet, ahead of the centre along the heading. */
function bonnetVent(vehicle: VehicleState): Emitter {
  const ahead = lengthOf(vehicle.kind) * BONNET_SHARE;
  return {
    x: vehicle.x + Math.cos(vehicle.heading) * ahead,
    y: vehicleHeight(vehicle.kind) * BONNET_HEIGHT_SHARE,
    z: vehicle.y + Math.sin(vehicle.heading) * ahead,
  };
}

/** Where a vehicle's puffs go, and what paces them. */
type Stack = {
  fire: ParticleSystem;
  smoke: ParticleSystem;
  rng: Rng;
  budget: number;
};

function vent(
  stack: Stack,
  state: Vent,
  vehicle: VehicleState,
  clock: number,
): void {
  const { wrecked } = vehicle;
  if (clock >= state.nextSmoke && stack.smoke.alive() < stack.budget) {
    const at = wrecked ? wreckVent(vehicle) : bonnetVent(vehicle);
    emitPuff(stack.smoke, stack.rng, wrecked ? WRECK_SMOKE : BONNET_SMOKE, at);
    state.nextSmoke =
      clock + (wrecked ? WRECK_SMOKE_INTERVAL_S : DAMAGED_SMOKE_INTERVAL_S);
  }
  if (!wrecked || clock < state.nextEmber) return;
  emitPuff(stack.fire, stack.rng, WRECK_EMBER, wreckVent(vehicle));
  state.nextEmber = clock + WRECK_EMBER_INTERVAL_S;
}

/**
 * Creates the vehicle smoke emitter.
 *
 * @param fire - Additive particles for a wreck's embers.
 * @param smoke - Normal-blended particles for the smoke; at most half of it is used here.
 * @returns The emitter; call `sync` once per frame.
 */
export function createVehicleSmoke(
  fire: ParticleSystem,
  smoke: ParticleSystem,
): VehicleSmoke {
  const stack: Stack = {
    fire,
    smoke,
    rng: createRng(VEHICLE_SMOKE_SEED),
    budget: Math.floor(smoke.capacity * AMBIENT_SMOKE_SHARE),
  };
  const vents = new Map<number, Vent>();
  let frame = 0;
  return {
    sync(vehicles, focus, clock) {
      frame += 1;
      for (const vehicle of vehicles) {
        if (!smokes(vehicle) || !withinRange(vehicle, focus)) continue;
        let state = vents.get(vehicle.id);
        if (!state) {
          state = { nextSmoke: clock, nextEmber: clock, seenFrame: frame };
          vents.set(vehicle.id, state);
        }
        state.seenFrame = frame;
        vent(stack, state, vehicle, clock);
      }
      for (const [id, state] of vents)
        if (state.seenFrame !== frame) vents.delete(id);
    },
  };
}
