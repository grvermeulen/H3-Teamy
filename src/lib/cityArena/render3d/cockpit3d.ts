/**
 * The first-person cockpit (spec §4): what the driver sees of their own car from the driver's seat
 * — dashboard and speedometer, the steering wheel turning in both hands, pillars, roof header,
 * door tops, the rear-view mirror, a faint sheen on the windscreen and the bonnet in the car's own
 * colour. Drawn in the view-model pass (`viewModelPass.ts`), so it never clips into the world.
 *
 * {@link Cockpit3d.object} is the car's own frame: place it where the car stands and turn it with
 * `headingToRotationY(heading)`. Geometry is built once per kind (the paint once per kind and
 * colour) and shared by every cockpit, until {@link disposeCockpitAssets}; a frame allocates
 * nothing.
 */
import {
  Group,
  Mesh,
  Object3D,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { POLICE_LIGHT_BLUE, POLICE_LIGHT_RED } from "../render/palette";
import { SIM_STEP_S } from "../sim/player";
import type { VehicleKind } from "../sim/types";
import { characterMaterials } from "./characterRig";
import {
  DIAL_SWEEP_RAD,
  dialPose,
  dialTickGeometry,
  eyeOf,
  glassGeometry,
  gripPoints,
  needleGeometry,
  paintGeometry,
  shellGeometry,
  sirenStripGeometry,
  wheelGeometry,
} from "./cockpitParts";
import { COCKPITS, type CockpitSpec, type CockpitWheel } from "./cockpitSpecs";
import { createGlowMaterial, type GlowMaterial } from "./glowMaterial";
import type { Vec3 } from "./lowPoly";
import { detailMaterial } from "./vehicleParts";
import { bodyColour } from "./vehicleModels";
import { LIGHT_BAR_FLASH_HZ } from "./vehicles3d";
import { armGeometry } from "./viewmodel";

/** What the cockpit shows each frame. */
export type CockpitInput = {
  kind: VehicleKind;
  /** `VehicleState.colour`; the bonnet wears `bodyColour(kind, colour)`. */
  colour: number;
  /** The front wheels' steering, −1…1, positive to the right (`trackSteer`). */
  steer: number;
  /** Speed along the heading, m/s; the speedometer reads its size. */
  speedMps: number;
  /** The police are driving it with the lights on. */
  siren: boolean;
  /** Simulation tick, which paces the light bar's glow. */
  tick: number;
  /** Seconds since the previous frame. */
  dt: number;
};

/** A cockpit. */
export type Cockpit3d = {
  /** Root in car space: +X forward, +Y up, +Z right, origin at the footprint centre on the ground. */
  object: Object3D;
  /** Rebuilds the model when the kind or colour changed, then turns the wheel and the needle. */
  update(input: CockpitInput): void;
  /** Detaches the cockpit; the shared geometry stays until {@link disposeCockpitAssets}. */
  dispose(): void;
};

/** The wheel's turn at full steering lock either way, radians (about 120°, spec §4). */
export const WHEEL_TURN_RAD = 2.1;
/** The speedometer's needle stops at this speed, m/s (144 km/h). */
export const SPEEDO_MAX_MPS = 40;
/** The drawn wheel follows the steering with this time constant, seconds: a keyboard snaps it. */
const WHEEL_EASE_S = 0.07;
/**
 * Share of the wheel's turn the forearms take back: the fists ride the rim, the forearms keep
 * pointing mostly toward the elbows instead of swinging round with it.
 */
const FOREARM_HOLD_SHARE = 0.85;
/** The hands grip the rim at ten to two: this far either side of its top, radians. */
const GRIP_ANGLE_RAD = Math.PI / 3;
/** The hands are drawn a little under life size: this close to the eye they would crowd the view. */
const HAND_SCALE = 0.75;
/** The elbows the forearms point to: ahead of, below and either side of the eye, metres. */
const ELBOW_AHEAD_M = 0.04;
const ELBOW_DROP_M = 0.58;
const ELBOW_SIDE_M = 0.27;
/** Halves of a light-bar flash cycle: blue lens, then red (as `vehicles3d`). */
const FLASH_PHASES = 2;
/** Simulation ticks per second, as an integer so the flash phase is exact. */
const TICKS_PER_SECOND = Math.round(1 / SIM_STEP_S);
/** Kinds whose light bar glows on the windscreen's top while the siren runs. */
const SIREN_KINDS: ReadonlySet<VehicleKind> = new Set<VehicleKind>(["police"]);
/** The windscreen's sheen: a faint cool additive glaze, fading toward the header. */
const SHEEN = { colour: 0xcfe0ff, opacity: 0.07, riseFade: 1.2 } as const;
/** The light bar's glow on the glass: faint, fading down from the header. */
const SIREN_GLOW_OPACITY = 0.32;
const SIREN_GLOW_FADE = 1.6;

/** A kind's shared geometry. */
type CockpitKit = {
  shell: BufferGeometry;
  wheel: BufferGeometry | null;
  glass: BufferGeometry | null;
  siren: { left: BufferGeometry; right: BufferGeometry } | null;
};

/** The shared glass and siren materials. */
type CockpitMaterials = {
  sheen: GlowMaterial;
  blue: GlowMaterial;
  red: GlowMaterial;
};

/** Kind → geometry, `kind:colour` → paint, and what every kind shares. */
const kits = new Map<VehicleKind, CockpitKit>();
const paints = new Map<string, BufferGeometry | null>();
let dialParts: { ticks: BufferGeometry; needle: BufferGeometry } | null = null;
let arms: { left: BufferGeometry; right: BufferGeometry } | null = null;
let materials: CockpitMaterials | null = null;

/** A kind's geometry, built on first use. */
function kitOf(kind: VehicleKind): CockpitKit {
  const cached = kits.get(kind);
  if (cached) return cached;
  const spec = COCKPITS[kind];
  const kit: CockpitKit = {
    shell: shellGeometry(spec),
    wheel: spec.wheel ? wheelGeometry(spec.wheel) : null,
    glass: glassGeometry(spec),
    siren: SIREN_KINDS.has(kind) ? sirenStripGeometry(spec) : null,
  };
  kits.set(kind, kit);
  return kit;
}

/** The bonnet's geometry in a kind's body colour, built on first use. */
function paintOf(kind: VehicleKind, colour: number): BufferGeometry | null {
  const hex = bodyColour(kind, colour);
  const key = `${kind}:${hex}`;
  if (paints.has(key)) return paints.get(key) ?? null;
  const geometry = paintGeometry(COCKPITS[kind], hex);
  paints.set(key, geometry);
  return geometry;
}

/** The glass and siren materials, created on first use. */
function materialsOf(): CockpitMaterials {
  const glow = (colour: string): GlowMaterial =>
    createGlowMaterial({
      colour,
      opacity: SIREN_GLOW_OPACITY,
      riseFade: SIREN_GLOW_FADE,
      fogShare: 0,
    });
  materials ??= {
    sheen: createGlowMaterial({ ...SHEEN, fogShare: 0 }),
    blue: glow(POLICE_LIGHT_BLUE),
    red: glow(POLICE_LIGHT_RED),
  };
  return materials;
}

/**
 * Frees every cockpit geometry and material and forgets them, so a view that has gone keeps none
 * (nor its renderer) reachable; the next cockpit builds them afresh.
 */
export function disposeCockpitAssets(): void {
  for (const kit of kits.values()) {
    kit.shell.dispose();
    kit.wheel?.dispose();
    kit.glass?.dispose();
    kit.siren?.left.dispose();
    kit.siren?.right.dispose();
  }
  kits.clear();
  for (const paint of paints.values()) paint?.dispose();
  paints.clear();
  dialParts?.ticks.dispose();
  dialParts?.needle.dispose();
  dialParts = null;
  arms?.left.dispose();
  arms?.right.dispose();
  arms = null;
  materials?.sheen.dispose();
  materials?.blue.dispose();
  materials?.red.dispose();
  materials = null;
}

/** A named mesh. */
function meshOf(
  name: string,
  geometry: BufferGeometry,
  material: Material,
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

/** One hand on the wheel or a grip: where it rests and the turn that points its forearm home. */
type Hand = { object: Object3D; rest: Quaternion };

/** The +Z the forearm runs along in the arm geometry, and world up. */
const UP = new Vector3(0, 1, 0);

/**
 * A hand at `grip` (in its parent's frame) whose forearm points back to `elbow` (same frame),
 * knuckles toward `up`.
 */
function createHand(
  side: "left" | "right",
  grip: Vector3,
  elbow: Vector3,
  up: Vector3,
): Hand {
  arms ??= { left: armGeometry("L"), right: armGeometry("R") };
  const object = meshOf(
    `cockpit-hand-${side}`,
    arms[side],
    characterMaterials().body,
  );
  object.position.copy(grip);
  object.scale.setScalar(HAND_SCALE);
  const rest = new Quaternion().setFromRotationMatrix(
    new Matrix4().lookAt(elbow, grip, up),
  );
  object.quaternion.copy(rest);
  return { object, rest };
}

/** The elbow on `side` (−1 left, 1 right) in car space. */
function elbowOf(spec: CockpitSpec, side: number): Vector3 {
  const eye = eyeOf(spec);
  return new Vector3(
    eye[0] + ELBOW_AHEAD_M,
    eye[1] - ELBOW_DROP_M,
    eye[2] + side * ELBOW_SIDE_M,
  );
}

/** The light bar's glow on the glass: both strips, each lit in its half of the flash. */
type SirenGlow = { group: Group; blue: Mesh; red: Mesh };

/** The live parts of a built model. */
type CockpitModel = {
  kind: VehicleKind;
  colour: number;
  root: Group;
  /** Turns about its local X, the column. */
  wheel: Object3D | null;
  hands: Hand[];
  needle: Object3D | null;
  headerGlow: SirenGlow | null;
  /** The wheel's drawn steering, eased toward the input. */
  steer: number;
};

/**
 * The steering wheel on its column, tilted back by the kind's tilt, with both hands on its rim at
 * ten to two, forearms pointing back to the elbows.
 */
function mountWheel(
  spec: CockpitSpec,
  wheelSpec: CockpitWheel,
  geometry: BufferGeometry,
  root: Group,
): { wheel: Object3D; hands: Hand[] } {
  const { radiusM, aheadM, dropM, tiltRad } = wheelSpec;
  const eye = eyeOf(spec);
  const mount = new Object3D();
  mount.position.set(eye[0] + aheadM, eye[1] - dropM, eye[2]);
  mount.rotation.z = -tiltRad;
  const wheel = new Object3D();
  wheel.name = "cockpit-wheel";
  wheel.add(meshOf("cockpit-wheel-rim", geometry, characterMaterials().body));
  mount.add(wheel);
  root.add(mount);
  mount.updateMatrix();
  const toMount = mount.matrix.clone().invert();
  const up = UP.clone().transformDirection(toMount);
  const hands = ([-1, 1] as const).map((side) => {
    const grip = new Vector3(
      0,
      Math.cos(GRIP_ANGLE_RAD) * radiusM,
      side * Math.sin(GRIP_ANGLE_RAD) * radiusM,
    );
    const elbow = elbowOf(spec, side).applyMatrix4(toMount);
    const hand = createHand(side < 0 ? "left" : "right", grip, elbow, up);
    wheel.add(hand.object);
    return hand;
  });
  return { wheel, hands };
}

/** The tank driver's hands on the two grips. */
function mountGrips(spec: CockpitSpec, root: Group): Hand[] {
  return gripPoints(spec).map((point: Vec3, index) => {
    const side = index === 0 ? -1 : 1;
    const hand = createHand(
      side < 0 ? "left" : "right",
      new Vector3(...point),
      elbowOf(spec, side),
      UP,
    );
    root.add(hand.object);
    return hand;
  });
}

/** The speedometer's lit scale and its needle, on the dial's own tilted frame. */
function mountDial(spec: CockpitSpec, root: Group): Object3D {
  dialParts ??= { ticks: dialTickGeometry(), needle: needleGeometry() };
  const { at, tiltRad } = dialPose(spec);
  const dial = new Object3D();
  dial.position.set(...at);
  dial.rotation.z = -tiltRad;
  const glow = characterMaterials().glow;
  const needle = meshOf("cockpit-needle", dialParts.needle, glow);
  dial.add(meshOf("cockpit-dial", dialParts.ticks, glow), needle);
  root.add(dial);
  return needle;
}

/** The light bar's two glows on the windscreen's top, hidden until the siren runs. */
function mountHeaderGlow(kit: CockpitKit, root: Group): SirenGlow | null {
  if (!kit.siren) return null;
  const lights = materialsOf();
  const group = new Group();
  group.name = "cockpit-header-glow";
  const blue = meshOf("cockpit-siren-left", kit.siren.left, lights.blue);
  const red = meshOf("cockpit-siren-right", kit.siren.right, lights.red);
  group.add(blue, red);
  group.visible = false;
  root.add(group);
  return { group, blue, red };
}

/** Builds a kind's cockpit in a colour, its wheel already at `steer`. */
function buildModel(
  kind: VehicleKind,
  colour: number,
  steer: number,
): CockpitModel {
  const spec = COCKPITS[kind];
  const kit = kitOf(kind);
  const root = new Group();
  root.name = `cockpit-${kind}`;
  root.add(meshOf("cockpit-shell", kit.shell, characterMaterials().body));
  const paint = paintOf(kind, colour);
  if (paint) root.add(meshOf("cockpit-bonnet", paint, detailMaterial()));
  if (kit.glass)
    root.add(meshOf("cockpit-glass", kit.glass, materialsOf().sheen));
  const mounted =
    kit.wheel && spec.wheel
      ? mountWheel(spec, spec.wheel, kit.wheel, root)
      : { wheel: null, hands: mountGrips(spec, root) };
  const needle = spec.frame === "hatch" ? null : mountDial(spec, root);
  const headerGlow = mountHeaderGlow(kit, root);
  return { kind, colour, root, ...mounted, needle, headerGlow, steer };
}

/** Along the column: the axis the wheel turns about. */
const COLUMN_AXIS = new Vector3(1, 0, 0);

/** Eases the drawn steering toward the input and turns the wheel; the forearms hold back. */
function turnWheel(model: CockpitModel, input: CockpitInput): void {
  if (!model.wheel) return;
  const ease = 1 - Math.exp(-Math.max(0, input.dt) / WHEEL_EASE_S);
  model.steer += (input.steer - model.steer) * ease;
  const turn = model.steer * WHEEL_TURN_RAD;
  model.wheel.rotation.x = turn;
  for (const hand of model.hands)
    hand.object.quaternion
      .setFromAxisAngle(COLUMN_AXIS, -turn * FOREARM_HOLD_SHARE)
      .multiply(hand.rest);
}

/**
 * The needle's angle for a speed: from the scale's lower-left end at rest, clockwise to its
 * lower-right end at {@link SPEEDO_MAX_MPS} and beyond.
 *
 * @param speedMps - Signed speed along the heading; reversing reads its size.
 * @returns The needle's turn about the dial's axis, radians.
 */
export function needleAngle(speedMps: number): number {
  const share = Math.min(1, Math.abs(speedMps) / SPEEDO_MAX_MPS);
  return -DIAL_SWEEP_RAD / 2 + share * DIAL_SWEEP_RAD;
}

/** Lights the light bar's glow in turn, blue then red, while the siren runs. */
function flashHeader(model: CockpitModel, input: CockpitInput): void {
  const glow = model.headerGlow;
  if (!glow) return;
  glow.group.visible = input.siren;
  if (!input.siren) return;
  const halves = Math.floor(
    (input.tick * LIGHT_BAR_FLASH_HZ * FLASH_PHASES) / TICKS_PER_SECOND,
  );
  const phase = halves % FLASH_PHASES;
  glow.blue.visible = phase === 0;
  glow.red.visible = phase === 1;
}

/**
 * Creates a cockpit. It builds its model on the first `update` and again whenever the kind or
 * colour changes; the wheel starts where the steering is, then eases after it.
 *
 * @returns The cockpit; place and turn its `object` like the car, then `update` it every frame.
 */
export function createCockpit3d(): Cockpit3d {
  const object = new Group();
  object.name = "cockpit";
  let model: CockpitModel | null = null;
  return {
    object,
    update(input) {
      if (model?.kind !== input.kind || model.colour !== input.colour) {
        model?.root.removeFromParent();
        model = buildModel(input.kind, input.colour, input.steer);
        object.add(model.root);
      }
      turnWheel(model, input);
      if (model.needle) model.needle.rotation.x = needleAngle(input.speedMps);
      flashHeader(model, input);
    },
    dispose() {
      model?.root.removeFromParent();
      model = null;
      object.removeFromParent();
    },
  };
}
