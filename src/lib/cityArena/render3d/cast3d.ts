/**
 * Everything in the 3D view that moves (spec §6.6–6.8): the cast from the entity sync, the mission
 * contacts standing in the street, the effects, the destruction (collapsing buildings, rubble,
 * falling furniture) and the first-person hands — one frame step for `index.ts` to call between
 * placing the camera and rendering.
 */
import { Group, Vector3, type Object3D, type PerspectiveCamera } from "three";
import type { Scene } from "../render/renderScene";
import type { CameraMode } from "./cameraRig";
import { createCharacter } from "./characters";
import { createContacts3d } from "./contacts3d";
import { createDestruction3d, type Destruction3d } from "./destruction3d";
import { createEffects3d, type Effects3d } from "./effects3d";
import {
  createEntitySync,
  type EntityFactories,
  type EntitySync,
  type EntityView,
} from "./entities";
import type { ContactSpot } from "./missionMarkers";
import { createPickup3d } from "./pickups3d";
import type { OverlayPass, RenderQuality } from "./renderer3d";
import { createVehicle3d } from "./vehicles3d";
import type { ViewModelInput } from "./viewmodel";
import {
  createViewModelPass,
  type CockpitPose,
  type ViewModelPass,
} from "./viewModelPass";

/** The real models: rigged characters, vehicles and pickups. */
export const REAL_ENTITY_FACTORIES: EntityFactories = {
  character: createCharacter,
  vehicle: createVehicle3d,
  pickup: createPickup3d,
};

/**
 * Particles alive at once per render quality (spec §8): fewer on "laag" for phones. Set by the
 * first frame's quality for the life of the view — the smoke pool is lent to the destruction
 * effects, so it is never rebuilt under them.
 */
export const EFFECT_PARTICLES: Record<RenderQuality, number> = {
  low: 600,
  auto: 1200,
  high: 1600,
};

/** No mission contacts in the street. */
const NO_CONTACTS: readonly ContactSpot[] = [];

/** What the cast reads from a frame; `View3dFrame` fits. */
export type CastFrame = {
  scene: Scene;
  dt: number;
  mode: CameraMode;
  aim: number;
  quality: RenderQuality;
};

/** The moving part of the 3D view. */
export type Cast3d = {
  /** Add to the scene once. */
  object: Object3D;
  /**
   * Syncs the cast and the effects to a frame, advances the destruction and poses the
   * first-person hands, or the cockpit of the car driven in first person.
   *
   * @param frame - The frame's scene, time step, camera mode, aim and quality.
   * @param focus - The camera focus, world metres: what the draw distances are measured from.
   * @param camera - The city camera, already placed for this frame.
   * @param contacts - The mission contacts to stand in the street (the mission markers').
   * @returns The hands' or cockpit's pass to draw over the city, or `null` when neither shows.
   */
  update(
    frame: CastFrame,
    focus: { x: number; y: number },
    camera: PerspectiveCamera,
    contacts?: readonly ContactSpot[],
  ): OverlayPass | null;
  /**
   * The collapses, rubble and falling furniture, made with the effects by the first `update`
   * (their dust shares the effects' smoke pool) and advanced by every `update`; `null` before
   * the first.
   */
  destruction(): Destruction3d | null;
  /** Frees every model, the effects, the destruction and the hands. */
  dispose(): void;
};

/** The effects and the destruction that borrows their smoke pool. */
type Fx = { effects: Effects3d; destruction: Destruction3d };

/** The effects and destruction, created by the first frame for its quality and kept from then on. */
function fxFor(parent: Group, current: Fx | null, quality: RenderQuality): Fx {
  if (current) return current;
  const effects = createEffects3d({ maxParticles: EFFECT_PARTICLES[quality] });
  const destruction = createDestruction3d(effects.smoke);
  parent.add(effects.object, destruction.object);
  return { effects, destruction };
}

/**
 * Fills the cockpit's reused pose from the car the local player drives in first person; `null`
 * while on foot, dead, in third person or in a wreck (the death camera or the car's own body
 * takes over).
 */
function cockpitPose(
  pose: CockpitPose,
  entities: EntitySync,
  frame: CastFrame,
): CockpitPose | null {
  const car = entities.local.vehicle;
  if (frame.mode !== "first" || !car || car.wrecked) return null;
  pose.kind = car.kind;
  pose.colour = car.colour;
  pose.steer = car.steer;
  pose.speedMps = car.speedMps;
  pose.siren = car.siren;
  pose.x = car.x;
  pose.y = car.y;
  pose.heading = car.heading;
  pose.tick = frame.scene.tick;
  pose.dt = frame.dt;
  return pose;
}

/** A cockpit pose to reuse every frame. */
function createCockpitPose(): CockpitPose {
  return {
    kind: "sedan",
    colour: 0,
    steer: 0,
    speedMps: 0,
    siren: false,
    tick: 0,
    dt: 0,
    x: 0,
    y: 0,
    heading: 0,
  };
}

/** Fills the hands' reused input from the entity sync's local player; `null` hides them. */
function handsInput(
  hands: ViewModelInput,
  entities: EntitySync,
  frame: CastFrame,
): ViewModelInput | null {
  if (frame.mode !== "first" || !entities.local.onFoot) return null;
  hands.weapon = entities.local.weapon;
  hands.firedTick = entities.local.firedTick;
  hands.speed = entities.local.speed;
  hands.tick = frame.scene.tick;
  hands.dt = frame.dt;
  return hands;
}

/** The first-person pass and the inputs it is handed, all reused every frame. */
type FirstPersonView = {
  hands: ViewModelPass;
  input: ViewModelInput;
  cockpit: CockpitPose;
  /** Receives your muzzle from the drawn gun. */
  muzzle: Vector3;
  /** Whether this frame drew the hands. */
  handsShown: boolean;
};

/** A first-person view around a pass, nothing shown yet. */
function createFirstPersonView(hands: ViewModelPass): FirstPersonView {
  return {
    hands,
    input: { weapon: "fist", firedTick: null, tick: 0, speed: 0, dt: 0 },
    cockpit: createCockpitPose(),
    muzzle: new Vector3(),
    handsShown: false,
  };
}

/**
 * Poses the hands on foot or the cockpit at the wheel, in first person; with the hands out, your
 * muzzle becomes the drawn gun's, so your shots leave it rather than the hidden body's.
 */
function poseFirstPerson(
  view: FirstPersonView,
  entities: EntitySync,
  frame: CastFrame,
  camera: PerspectiveCamera,
): OverlayPass | null {
  const drawn = handsInput(view.input, entities, frame);
  view.handsShown = drawn !== null;
  const cockpit = cockpitPose(view.cockpit, entities, frame);
  const pass = view.hands.update(camera, drawn, cockpit);
  if (view.hands.muzzleWorld(view.muzzle))
    entities.muzzles.set(frame.scene.localPlayerId, view.muzzle);
  return pass;
}

/**
 * The cast, effects and hands of the 3D view.
 *
 * @param factories - Builds the models; the real ones by default.
 * @param hands - The first-person hands' pass; a fresh one by default.
 * @returns The cast; add its `object` to the scene and call `update` every frame.
 */
export function createCast3d(
  factories: EntityFactories = REAL_ENTITY_FACTORIES,
  hands: ViewModelPass = createViewModelPass(),
): Cast3d {
  const object = new Group();
  object.name = "cast";
  const entities = createEntitySync(factories);
  const street = createContacts3d(factories);
  object.add(entities.group, street.object);
  const view: EntityView = { firstPerson: false, aim: 0 };
  const firstPerson = createFirstPersonView(hands);
  let fx: Fx | null = null;
  return {
    object,
    update(frame, focus, camera, contacts = NO_CONTACTS) {
      view.firstPerson = frame.mode === "first";
      view.aim = frame.aim;
      entities.update(frame.scene, frame.dt, focus, view);
      street.update(contacts, frame.scene, focus);
      const pass = poseFirstPerson(firstPerson, entities, frame, camera);
      fx = fxFor(object, fx, frame.quality);
      // Your own flame moves to the hands' barrel only while the hands are there to show it.
      fx.effects.sync(
        frame.scene,
        focus,
        firstPerson.handsShown,
        entities.muzzles.points,
      );
      fx.effects.update(frame.dt);
      fx.destruction.update(frame.dt);
      return pass;
    },
    destruction: () => fx?.destruction ?? null,
    dispose() {
      entities.dispose();
      street.dispose();
      // The destruction leaves the smoke pool it borrowed to the effects, so it goes first.
      fx?.destruction.dispose();
      fx?.effects.dispose();
      hands.dispose();
    },
  };
}
