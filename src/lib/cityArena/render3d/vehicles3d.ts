/**
 * A live 3D vehicle: a model from `vehicleModels.ts` plus what moves on it each frame — wheels
 * rolling with speed and steering, the brake lamps lighting as it slows, the police light bar
 * flashing, the tank's turret following its driver's aim, and the charred look of a wreck with its
 * lamps dark (spec §6.7).
 *
 * The caller places and turns `object` (position from the simulation, `rotation.y` from
 * `headingToRotationY(heading)`) and then calls `update`; the turret reads the hull's heading from
 * that rotation.
 *
 * {@link createVehicleFactory} builds each vehicle from the Kenney Car Kit once it has loaded, and
 * procedurally until then (and always for the bus, the oldtimer and the tank).
 */
import {
  Mesh,
  Points,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";
import { isCarKind } from "../carManifest";
import type { VehicleKind } from "../sim/types";
import { SIM_STEP_S } from "../sim/player";
import { carAssetsReady, requestCarAssets, type CarAssets } from "./carAssets";
import { headingToRotationY } from "./coords";
import type { EntityFactories } from "./entities";
import { charredMaterial } from "./vehicleParts";
import { showBraking, showFlares, type LampRig } from "./vehicleLamps";
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
/** Deceleration past which the brake lamps light, m/s²: above coasting (3), below braking (14). */
export const BRAKE_LIGHT_DECEL_MPS2 = 6;
/** A faster drop in speed is a crash, a teleport or a respawn, not braking, m/s². */
const IMPLAUSIBLE_DECEL_MPS2 = 60;
/** How long the brake lamps stay lit after the vehicle stops slowing, seconds, so they never flicker. */
const BRAKE_HOLD_S = 0.3;

/** What one frame tells a vehicle. */
export type Vehicle3dInput = {
  /** Signed speed along the heading, m/s; negative in reverse. */
  speed: number;
  /** Steering in −1..1, positive to the right. */
  steer: number;
  /** Burnt out: every part turns charred and the lights go dark. */
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
  /** Brake lamps lit; when absent, the vehicle works it out from its speed frame to frame. */
  braking?: boolean;
};

/** What the brake lamps remember between frames: the last speed, how long ago it changed, the hold. */
export type BrakeWatch = { speed: number; since: number; hold: number };

/**
 * A brake watch for a vehicle that has not reported a speed yet.
 *
 * @returns A watch at rest with its lamps off.
 */
export function createBrakeWatch(): BrakeWatch {
  return { speed: 0, since: 0, hold: 0 };
}

/**
 * Whether a vehicle is braking, from the speed it reports each frame. The speed changes only on
 * simulation ticks or snapshots, so the deceleration is measured over the time since it last
 * changed (never less than one tick), not over one frame; slowing faster than coasting lights the
 * lamps and they stay lit `BRAKE_HOLD_S` after, while a drop too sudden to be braking (a crash, a
 * respawn) is ignored.
 *
 * @param watch - The vehicle's watch; updated in place.
 * @param speed - Signed speed along the heading this frame, m/s.
 * @param dt - Seconds since the last frame.
 * @returns Whether the brake lamps are lit.
 */
export function watchBrakes(
  watch: BrakeWatch,
  speed: number,
  dt: number,
): boolean {
  watch.since += dt;
  watch.hold = Math.max(0, watch.hold - dt);
  if (speed !== watch.speed && watch.since > 0) {
    const span = Math.max(watch.since, SIM_STEP_S);
    const deceleration = (Math.abs(watch.speed) - Math.abs(speed)) / span;
    if (
      deceleration > BRAKE_LIGHT_DECEL_MPS2 &&
      deceleration < IMPLAUSIBLE_DECEL_MPS2
    )
      watch.hold = BRAKE_HOLD_S;
    watch.speed = speed;
    watch.since = 0;
  }
  return watch.hold > 0;
}

/**
 * A vehicle in the 3D scene. Each frame the caller places `object` and sets its `rotation.y` to
 * `headingToRotationY(heading)` before calling `update`: the tank's turret derives the hull's
 * heading from that rotation.
 */
export type Vehicle3d = {
  /**
   * The model; local forward +X, origin at the footprint centre on the ground. Set its
   * `rotation.y` to `headingToRotationY(heading)` before each `update` — the turret aims relative
   * to it.
   */
  object: Object3D;
  /** Moves the wheels, lights and turret, and dresses a wreck; call after turning `object`. */
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

/**
 * Frees each geometry under `root` once (wheels on an axle share theirs), leaving what the model
 * shares with the other vehicles of its kind.
 */
function disposeGeometries(
  root: Object3D,
  shared: ReadonlySet<BufferGeometry> | undefined,
): void {
  const released = new Set<BufferGeometry>(shared);
  root.traverse((node) => {
    if (!(node instanceof Mesh || node instanceof Points)) return;
    if (released.has(node.geometry)) return;
    released.add(node.geometry);
    node.geometry.dispose();
  });
}

/** What a vehicle's lamps show now: whether wrecked, and whether braking. */
type LampState = { wrecked: boolean; braking: boolean };

/** Chars a wreck or restores it, darkens its lamps, and lights the brake lamps while braking. */
function showLamps(
  lamps: LampRig,
  intact: ReadonlyMap<Mesh, Material | Material[]>,
  shown: LampState,
  next: LampState,
): void {
  if (next.wrecked !== shown.wrecked) {
    shown.wrecked = next.wrecked;
    dress(intact, shown.wrecked);
    showFlares(lamps, !shown.wrecked);
  }
  if (!shown.wrecked && next.braking !== shown.braking) {
    shown.braking = next.braking;
    showBraking(lamps, shown.braking);
  }
}

/**
 * Creates a vehicle for the 3D scene. Every frame, set the returned `object`'s position and its
 * `rotation.y` to `headingToRotationY(heading)` before calling `update`: the tank's turret derives
 * the hull's heading from `object.rotation.y`, so a stale rotation aims it wrong.
 *
 * @param kind - The vehicle kind.
 * @param colour - `VehicleState.colour`; ignored by kinds with a fixed livery.
 * @param cars - The loaded Kenney Car Kit, or null (the default) for a procedural model.
 * @returns The vehicle; call `update` every frame after placing and turning its `object`.
 */
export function createVehicle3d(
  kind: VehicleKind,
  colour: number,
  cars: CarAssets | null = null,
): Vehicle3d {
  const model = buildVehicleModel(kind, colour, cars);
  const intact = intactMaterials(model.root);
  const watch = createBrakeWatch();
  const shown: LampState = { wrecked: false, braking: false };
  return {
    object: model.root,
    update(input) {
      const braking =
        input.braking ?? watchBrakes(watch, input.speed, input.dt);
      showLamps(model.lamps, intact, shown, {
        wrecked: input.wrecked,
        braking,
      });
      rollWheels(model.wheels, input);
      flashLightBar(model.lightBar, input);
      aimTurret(model, input.turretYaw);
    },
    dispose() {
      disposeGeometries(model.root, model.shared);
    },
  };
}

/** Where the vehicle factory gets the Kit's models from; tests pass fakes. */
export type CarAssetSource = {
  /** The loaded models, or `null` while loading, after a failure or before a request. */
  ready(): CarAssets | null;
  /** Starts loading if nothing has yet; must not allocate once it has. */
  request(): void;
};

/** The session's Kit models. */
const LOADED_CARS: CarAssetSource = {
  ready: carAssetsReady,
  request: requestCarAssets,
};

/** Each kind's pool variants by colour index: procedural, then built from the Kit. */
const VARIANTS = {
  procedural: new Map<VehicleKind, string[]>(),
  kit: new Map<VehicleKind, string[]>(),
};

/** A kind and colour's pool variant, interned so asking again allocates nothing. */
function variantOf(kind: VehicleKind, colour: number, kit: boolean): string {
  const byKind = kit ? VARIANTS.kit : VARIANTS.procedural;
  let byColour = byKind.get(kind);
  if (!byColour) {
    byColour = [];
    byKind.set(kind, byColour);
  }
  byColour[colour] ??= `${kit ? "gltf:" : ""}${kind}:${colour}`;
  return byColour[colour];
}

/** The loaded Kit when a vehicle of `kind` should be built from it; asks for it to load otherwise. */
function carsFor(source: CarAssetSource, kind: VehicleKind): CarAssets | null {
  const cars = source.ready();
  if (!cars) source.request();
  return cars && isCarKind(kind) ? cars : null;
}

/** The vehicle hooks of {@link EntityFactories}. */
export type VehicleFactory = Pick<
  EntityFactories,
  "vehicle" | "vehicleVariant"
>;

/**
 * The vehicle factory (spec §8): Kenney Car Kit models once they have loaded, for the kinds the
 * Kit covers; procedural models otherwise — before the files arrive, after they fail, and for the
 * bus, oldtimer and tank. Asking for a vehicle starts the loading; when it lands, each car's pool
 * variant changes (`gltf:<kind>:<colour>`) and the entity sync swaps it once.
 *
 * @param source - The Kit's models; the session's by default.
 * @returns The hooks for {@link EntityFactories}.
 */
export function createVehicleFactory(
  source: CarAssetSource = LOADED_CARS,
): VehicleFactory {
  return {
    vehicle: (kind, colour) =>
      createVehicle3d(kind, colour, carsFor(source, kind)),
    vehicleVariant: (kind, colour) =>
      variantOf(kind, colour, carsFor(source, kind) !== null),
  };
}
