/**
 * Small procedural weapon models held in a character's hand and in the first-person view. Each
 * model's origin is the centre of the grip (where the fist closes), its barrel points along +X and
 * its top faces +Y. Geometry is merged and cached per kind; every model shares the characters'
 * vertex-coloured material.
 */
import { Group, Mesh, type BufferGeometry, type Object3D } from "three";
import type { WeaponKind } from "../sim/types";
import { characterMaterials } from "./characterRig";
import {
  block,
  mergeParts,
  rod,
  type BlockSpec,
  type RodSpec,
  type Vec3,
} from "./lowPoly";

/** Anything a 3D model can hold: the simulation's weapons plus the rocket launcher. */
export type ModelWeapon = WeaponKind | "rocket";

/** Weapons held with both hands. */
const TWO_HANDED: ReadonlySet<ModelWeapon> = new Set<ModelWeapon>([
  "shotgun",
  "rifle",
  "rocket",
]);

/**
 * Whether a weapon is held with both hands.
 *
 * @param kind - The weapon.
 * @returns `true` for the shotgun, rifle and rocket launcher.
 */
export function isTwoHanded(kind: ModelWeapon): boolean {
  return TWO_HANDED.has(kind);
}

/** Blued steel of slides and receivers. */
const GUNMETAL = 0x2c2f35;
/** Polymer grips and furniture. */
const GRIP_BLACK = 0x161618;
/** Bare steel of barrels. */
const STEEL = 0x5a5e64;
/** Stained walnut. */
const WALNUT = 0x7a4a26;
/** A bat's pale ash. */
const ASH = 0xc39457;
/** Grip tape. */
const TAPE = 0x222226;
/** The launcher's olive drab. */
const OLIVE = 0x56612f;
/** Darker olive for rings and the warhead's body. */
const OLIVE_DARK = 0x3b4321;
/** The warhead's red nose. */
const WARHEAD_RED = 0xc4261e;
/** The dark bore of a muzzle. */
const MUZZLE = 0x0a0a0a;
/** Tilt of a pistol grip: its bottom sits behind its top, radians. */
const GRIP_RAKE = -0.25;
/** A stock that deepens toward the shoulder and drops a little behind the grip. */
const STOCK_DROP: Partial<BlockSpec> = {
  chamfer: 0.3,
  taper: 1.25,
  rotation: [0, 0, 0.1],
};
/** A magazine curving forward below the receiver. */
const MAGAZINE_CURVE: Partial<BlockSpec> = {
  chamfer: 0.2,
  rotation: [0, 0, 0.3],
};

/** One part of a weapon model: a block, or a rod along the barrel axis. */
type WeaponPart =
  ({ shape: "block" } & BlockSpec) | ({ shape: "rod" } & RodSpec);

/** A block part. */
function box(
  size: Vec3,
  at: Vec3,
  colour: number,
  shaping: Partial<BlockSpec> = {},
): WeaponPart {
  return { shape: "block", size, at, colour, ...shaping };
}

/** A rod part along the barrel (+X) axis, centred at `at`. */
function tube(
  radius: number,
  length: number,
  at: Vec3,
  colour: number,
  shaping: Partial<RodSpec> = {},
): WeaponPart {
  return { shape: "rod", radius, length, at, colour, axis: "x", ...shaping };
}

/** A grip raked back like a pistol's. */
const RAKED: Partial<BlockSpec> = { chamfer: 0.3, rotation: [0, 0, GRIP_RAKE] };
/** Rounded edges. */
const SOFT: Partial<BlockSpec> = { chamfer: 0.3 };
/** Height of the launcher's tube axis above the grip, metres. */
const TUBE_Y = 0.1;
/** The launcher's tube is ten-sided. */
const TEN_SIDED: Partial<RodSpec> = { sides: 10 };

/**
 * The parts of every weapon that has a model, grip at the origin, barrel along +X:
 * - pistol: slide, frame, raked grip, trigger guard and muzzle;
 * - uzi: boxy body, barrel stub, magazine through the grip, folded stock, front sight;
 * - shotgun: receiver, barrel over the magazine tube, wooden pump, stock and grip;
 * - rifle: receiver, handguard, barrel, curved magazine, stock, grip and sights;
 * - bat: knob, taped handle and a barrel that swells toward the end;
 * - rocket: olive tube with a flared back and rings, red-nosed warhead, two grips and a sight.
 */
const WEAPON_PARTS: Partial<Record<ModelWeapon, readonly WeaponPart[]>> = {
  pistol: [
    box([0.19, 0.036, 0.028], [0.055, 0.058, 0], GUNMETAL, SOFT),
    box([0.12, 0.02, 0.026], [0.05, 0.032, 0], GRIP_BLACK),
    box([0.04, 0.1, 0.03], [0, -0.005, 0], GRIP_BLACK, RAKED),
    box([0.04, 0.008, 0.012], [0.045, 0.012, 0], GRIP_BLACK),
    tube(0.009, 0.012, [0.152, 0.06, 0], MUZZLE),
  ],
  uzi: [
    box([0.24, 0.06, 0.042], [0.07, 0.06, 0], GUNMETAL, SOFT),
    tube(0.011, 0.06, [0.215, 0.065, 0], STEEL),
    box([0.035, 0.17, 0.028], [0.01, -0.03, 0], GRIP_BLACK, SOFT),
    box([0.1, 0.012, 0.03], [-0.075, 0.08, 0], STEEL),
    box([0.02, 0.02, 0.014], [0.17, 0.1, 0], GRIP_BLACK),
  ],
  shotgun: [
    box([0.2, 0.065, 0.045], [0.06, 0.06, 0], GUNMETAL, SOFT),
    tube(0.014, 0.5, [0.41, 0.078, 0], STEEL),
    tube(0.012, 0.4, [0.36, 0.047, 0], GUNMETAL),
    box([0.16, 0.042, 0.052], [0.36, 0.045, 0], WALNUT, { chamfer: 0.4 }),
    box([0.3, 0.07, 0.042], [-0.19, 0.035, 0], WALNUT, STOCK_DROP),
    box([0.035, 0.09, 0.03], [0, 0, 0], WALNUT, RAKED),
  ],
  rifle: [
    box([0.26, 0.07, 0.045], [0.06, 0.06, 0], GUNMETAL, SOFT),
    box([0.2, 0.052, 0.05], [0.3, 0.063, 0], GRIP_BLACK, SOFT),
    tube(0.011, 0.2, [0.46, 0.07, 0], STEEL),
    box([0.05, 0.14, 0.03], [0.12, -0.02, 0], GRIP_BLACK, MAGAZINE_CURVE),
    box([0.26, 0.065, 0.04], [-0.21, 0.045, 0], GRIP_BLACK, STOCK_DROP),
    box([0.035, 0.09, 0.03], [0, 0, 0], GRIP_BLACK, RAKED),
    box([0.03, 0.035, 0.012], [0.5, 0.1, 0], GRIP_BLACK),
    box([0.09, 0.022, 0.022], [0.02, 0.105, 0], GRIP_BLACK),
  ],
  bat: [
    tube(0.026, 0.02, [-0.09, 0, 0], ASH),
    tube(0.021, 0.38, [0.1, 0, 0], ASH, { radiusStart: 0.017 }),
    tube(0.02, 0.18, [0.01, 0, 0], TAPE),
    tube(0.037, 0.47, [0.525, 0, 0], ASH, { radiusStart: 0.021 }),
    tube(0.032, 0.02, [0.77, 0, 0], ASH, { radiusStart: 0.037 }),
  ],
  rocket: [
    tube(0.055, 1, [0.15, TUBE_Y, 0], OLIVE, TEN_SIDED),
    tube(0.055, 0.08, [-0.39, TUBE_Y, 0], OLIVE_DARK, {
      ...TEN_SIDED,
      radiusStart: 0.075,
    }),
    tube(0.062, 0.04, [0.63, TUBE_Y, 0], OLIVE_DARK, TEN_SIDED),
    tube(0.062, 0.04, [-0.1, TUBE_Y, 0], OLIVE_DARK, TEN_SIDED),
    tube(0.045, 0.1, [0.7, TUBE_Y, 0], OLIVE_DARK),
    tube(0, 0.12, [0.81, TUBE_Y, 0], WARHEAD_RED, { radiusStart: 0.045 }),
    box([0.04, 0.1, 0.032], [0, 0, 0], GRIP_BLACK, RAKED),
    box([0.035, 0.08, 0.03], [0.3, 0.015, 0], GRIP_BLACK, SOFT),
    box([0.07, 0.05, 0.03], [0.12, TUBE_Y + 0.07, -0.05], GRIP_BLACK, SOFT),
  ],
};

/** The geometry of one part. */
function partGeometry(part: WeaponPart): BufferGeometry {
  return part.shape === "block" ? block(part) : rod(part);
}

const geometryCache = new Map<ModelWeapon, BufferGeometry>();

/** The merged geometry of a weapon, built once; `null` for bare fists and the tank's cannon. */
function weaponGeometry(kind: ModelWeapon): BufferGeometry | null {
  const cached = geometryCache.get(kind);
  if (cached) return cached;
  const parts = WEAPON_PARTS[kind];
  if (!parts) return null;
  const geometry = mergeParts(parts.map(partGeometry));
  geometryCache.set(kind, geometry);
  return geometry;
}

/**
 * A model of a weapon to put in a hand: pistol, uzi, shotgun, rifle, bat or rocket launcher. A
 * fist (or the tank's cannon, never carried) gives an empty group. The geometry and material are
 * shared: never dispose them through the model.
 *
 * @param kind - The weapon.
 * @returns A group, grip at its origin and barrel along +X.
 */
export function createWeaponModel(kind: ModelWeapon): Object3D {
  const model = new Group();
  model.name = `weapon:${kind}`;
  const geometry = weaponGeometry(kind);
  if (geometry) model.add(new Mesh(geometry, characterMaterials().body));
  return model;
}
