/**
 * A live 3D vehicle: a model from `vehicleModels.ts` plus what moves on it each frame — wheels
 * rolling with speed and steering, the police light bar flashing, the tank's turret following its
 * driver's aim, and the charred look of a wreck (spec §6.7).
 *
 * The caller places and turns `object` (position from the simulation, `rotation.y` from
 * `headingToRotationY(heading)`) and then calls `update`; the turret reads the hull's heading from
 * that rotation.
 */
import { Mesh, type BufferGeometry, type Material, type Object3D } from "three";
import type { VehicleKind } from "../sim/types";
import { SIM_STEP_S } from "../sim/player";
import { headingToRotationY } from "./coords";
import { charredMaterial } from "./vehicleParts";
import {
  buildVehicleModel,
  lensMaterial,
  type LightBarRig,
  type VehicleModel,
  type WheelRig,
} from "./vehicleModels";

export { vehicleHeight } from "./vehicleModels";

/** Front wheel angle at full steering lock, radians (spec §6.7: `steer × 0.5 rad`). */
export const FRONT_WHEEL_LOCK_RAD = 0.5;
/** Blue-then-red cycles of the police light bar per second (spec §6.7). */
export const LIGHT_BAR_FLASH_HZ = 4;
/** Halves of a flash cycle: the blue lens lights, then the red one. */
const FLASH_PHASES = 2;
/** Simulation ticks per second, as an integer so the flash phase is exact. */
const TICKS_PER_SECOND = Math.round(1 / SIM_STEP_S);
/** One full wheel turn; the spin angle wraps at it so it never grows without bound. */
const FULL_TURN_RAD = Math.PI * 2;

/** What one frame tells a vehicle. */
export type Vehicle3dInput = {
  /** Signed speed along the heading, m/s; negative in reverse. */
  speed: number;
  /** Steering in −1..1, positive to the right. */
  steer: number;
  wrecked: boolean;
  /** The police are driving it with the lights on. */
  siren: boolean;
  /** Simulation tick, which paces the light bar. */
  tick: number;
  /** Current health. The model does not change with it; smoke from a damaged car is an effect. */
  health: number;
  /** World heading the tank's driver aims at, or `null` with nobody aiming. */
  turretYaw: number | null;
  /** Seconds since the last frame. */
  dt: number;
};

/** A vehicle in the 3D scene. */
export type Vehicle3d = {
  /** The model; local forward +X, origin at the footprint centre on the ground. */
  object: Object3D;
  /** Moves the wheels, lights and turret, and dresses a wreck. */
  update(input: Vehicle3dInput): void;
  /** Frees the geometry; the materials are shared and stay. Detach `object` yourself. */
  dispose(): void;
};

/** Every mesh's intact material(s), to restore when a wreck is reused for a whole car. */
function intactMaterials(root: Object3D): Map<Mesh, Material | Material[]> {
  const intact = new Map<Mesh, Material | Material[]>();
  root.traverse((node) => {
    if (node instanceof Mesh) intact.set(node, node.material);
  });
  return intact;
}

/** Swaps every material for the shared char, or back to the intact ones. */
function dress(
  intact: ReadonlyMap<Mesh, Material | Material[]>,
  wrecked: boolean,
): void {
  for (const [mesh, material] of intact)
    mesh.material = wrecked ? charredMaterial() : material;
}

/** Spins every wheel by `speed / radius` and turns the steering pair. */
function rollWheels(wheels: readonly WheelRig[], input: Vehicle3dInput): void {
  const steerY = headingToRotationY(input.steer * FRONT_WHEEL_LOCK_RAD);
  for (const wheel of wheels) {
    // Rolling toward +X turns a wheel about +Z clockwise, i.e. by a negative angle.
    const turn = (input.speed / wheel.radius) * input.dt;
    wheel.spinner.rotation.z =
      (wheel.spinner.rotation.z - turn) % FULL_TURN_RAD;
    if (wheel.steers) wheel.pivot.rotation.y = steerY;
  }
}

/** 0 while the blue lens is lit, 1 while the red one is. */
function flashPhase(tick: number): number {
  const halves = Math.floor(
    (tick * LIGHT_BAR_FLASH_HZ * FLASH_PHASES) / TICKS_PER_SECOND,
  );
  return halves % FLASH_PHASES;
}

/** Lights the lenses in turn while the siren is on; a wreck's bar stays charred. */
function flashLightBar(bar: LightBarRig | null, input: Vehicle3dInput): void {
  if (!bar || input.wrecked) return;
  const phase = flashPhase(input.tick);
  bar.left.material = lensMaterial("left", input.siren && phase === 0);
  bar.right.material = lensMaterial("right", input.siren && phase === 1);
}

/** Turns the turret to the world aim, relative to the hull; straight ahead with no aim. */
function aimTurret(model: VehicleModel, turretYaw: number | null): void {
  if (!model.turret) return;
  model.turret.rotation.y =
    turretYaw === null
      ? 0
      : headingToRotationY(turretYaw) - model.root.rotation.y;
}

/** Frees each geometry under `root` once; wheels on an axle share theirs. */
function disposeGeometries(root: Object3D): void {
  const released = new Set<BufferGeometry>();
  root.traverse((node) => {
    if (!(node instanceof Mesh) || released.has(node.geometry)) return;
    released.add(node.geometry);
    node.geometry.dispose();
  });
}

/**
 * Creates a vehicle for the 3D scene.
 *
 * @param kind - The vehicle kind.
 * @param colour - `VehicleState.colour`; ignored by kinds with a fixed livery.
 * @returns The vehicle; call `update` every frame after placing its `object`.
 */
export function createVehicle3d(kind: VehicleKind, colour: number): Vehicle3d {
  const model = buildVehicleModel(kind, colour);
  const intact = intactMaterials(model.root);
  let wreckShown = false;
  return {
    object: model.root,
    update(input) {
      if (input.wrecked !== wreckShown) {
        wreckShown = input.wrecked;
        dress(intact, wreckShown);
      }
      rollWheels(model.wheels, input);
      flashLightBar(model.lightBar, input);
      aimTurret(model, input.turretYaw);
    },
    dispose() {
      disposeGeometries(model.root);
    },
  };
}
