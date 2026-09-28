/**
 * Accessories a glTF character wears over its model (spec §7, "Diversity"): a cap, glasses, the
 * player's red-lensed shades and bead bracelet, a backpack, an officer's badge. Each is a small
 * rigid mesh in the vertex-coloured material every procedural character and weapon shares,
 * parented to a bone of the model and placed in that bone's frame (metres: x to the character's
 * left, y up the bone, z forward). Geometry is merged and cached per kind and colour.
 */
import { Group, Mesh, type BufferGeometry, type Object3D } from "three";
import type { AppearanceExtra } from "./characterAppearance";
import { characterMaterials } from "./characterRig";
import {
  block,
  mergeParts,
  rod,
  type BlockSpec,
  type RodSpec,
} from "./lowPoly";

/** The bones accessories hang on, as three.js names the packs' bones. */
export type AccessoryBone = "Head" | "Chest" | "WristL";

/** One part of an accessory; glowing parts are drawn unlit (the player's lenses). */
type AccessoryPart = { glow?: boolean } & (
  ({ shape: "block" } & BlockSpec) | ({ shape: "rod" } & RodSpec)
);

/** How an accessory is built: its bone and its parts in that bone's frame. */
type AccessorySpec = {
  bone: AccessoryBone;
  parts(colour: number, female: boolean): AccessoryPart[];
};

/** Height of the eyes above the head bone, and the face's front, metres. */
const EYE_Y = 0.125;
const FACE_Z = 0.14;
/** Half the width of the head at the temples, metres. */
const TEMPLE_X = 0.115;
/** How far the back sits behind the chest bone, for men and women, metres. */
const BACK_Z_MALE = -0.11;
const BACK_Z_FEMALE = -0.06;
/** How far the chest sits ahead of the chest bone, metres. */
const CHEST_FRONT_Z = 0.125;
/** Dark frames, dark glass, a backpack's straps, beads' cord. */
const FRAME_BLACK = 0x141414;
const GLASS_DARK = 0x26303a;
const STRAP_DARK = 0x2a1c1c;
const CORD_DARK = 0x2a2a2a;

/** A block part. */
function box(
  size: BlockSpec["size"],
  at: BlockSpec["at"],
  colour: number,
  shaping: Partial<BlockSpec> = {},
): AccessoryPart {
  return { shape: "block", size, at, colour, ...shaping };
}

/** A frame across the eyes with two lenses and the temples running back. */
function eyewear(frame: number, lens: number, glow: boolean): AccessoryPart[] {
  const lenses = [-1, 1].map((side): AccessoryPart => ({
    ...box(
      [0.075, 0.045, 0.01],
      [side * 0.05, EYE_Y - 0.005, FACE_Z + 0.004],
      lens,
    ),
    glow,
  }));
  return [
    box([0.24, 0.012, 0.012], [0, EYE_Y + 0.02, FACE_Z], frame),
    ...lenses,
    box([0.008, 0.01, 0.15], [TEMPLE_X, EYE_Y + 0.015, FACE_Z - 0.075], frame),
    box([0.008, 0.01, 0.15], [-TEMPLE_X, EYE_Y + 0.015, FACE_Z - 0.075], frame),
  ];
}

/** Every accessory's build. */
const ACCESSORIES: Record<AppearanceExtra["kind"], AccessorySpec> = {
  glasses: {
    bone: "Head",
    parts: (colour) => eyewear(colour, GLASS_DARK, false),
  },
  sunglasses: {
    bone: "Head",
    parts: (colour) => eyewear(FRAME_BLACK, colour, true),
  },
  cap: {
    bone: "Head",
    parts: (colour) => [
      box([0.245, 0.095, 0.275], [0, 0.245, -0.01], colour, { chamfer: 0.6 }),
      box([0.2, 0.014, 0.13], [0, 0.215, 0.175], colour, {
        chamfer: 0.3,
        rotation: [0.12, 0, 0],
      }),
    ],
  },
  backpack: {
    bone: "Chest",
    parts: (colour, female) => {
      const back = female ? BACK_Z_FEMALE : BACK_Z_MALE;
      return [
        box([0.26, 0.32, 0.12], [0, 0.04, back - 0.06], colour, {
          chamfer: 0.35,
        }),
        box([0.2, 0.1, 0.05], [0, -0.02, back - 0.135], colour, {
          chamfer: 0.4,
        }),
        box([0.035, 0.02, 0.2], [0.08, 0.2, back + 0.08], STRAP_DARK),
        box([0.035, 0.02, 0.2], [-0.08, 0.2, back + 0.08], STRAP_DARK),
      ];
    },
  },
  badge: {
    bone: "Chest",
    parts: (colour) => [
      box([0.045, 0.055, 0.012], [0.07, 0.1, CHEST_FRONT_Z], colour, {
        chamfer: 0.3,
      }),
    ],
  },
  bracelet: {
    bone: "WristL",
    parts: (colour) => [
      {
        shape: "rod",
        radius: 0.04,
        length: 0.022,
        at: [0, 0.012, 0],
        axis: "y",
        colour: CORD_DARK,
        sides: 10,
      },
      {
        shape: "rod",
        radius: 0.043,
        length: 0.008,
        at: [0, 0.012, 0],
        axis: "y",
        colour,
        sides: 10,
      },
    ],
  },
};

/** The geometry of one part. */
function partGeometry(part: AccessoryPart): BufferGeometry {
  return part.shape === "block" ? block(part) : rod(part);
}

/** Merged geometry per accessory, colour and build: `[lit, glowing]` (either may be missing). */
const geometryCache = new Map<
  string,
  [BufferGeometry | null, BufferGeometry | null]
>();

/** An accessory's merged geometry, built once. */
function accessoryGeometry(
  extra: AppearanceExtra,
  female: boolean,
): [BufferGeometry | null, BufferGeometry | null] {
  const key = `${extra.kind}:${extra.colour}:${female}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const parts = ACCESSORIES[extra.kind].parts(extra.colour, female);
  const merge = (glow: boolean): BufferGeometry | null => {
    const chosen = parts.filter((part) => (part.glow ?? false) === glow);
    return chosen.length > 0 ? mergeParts(chosen.map(partGeometry)) : null;
  };
  const built: [BufferGeometry | null, BufferGeometry | null] = [
    merge(false),
    merge(true),
  ];
  geometryCache.set(key, built);
  return built;
}

/**
 * An accessory to parent to its bone. The geometry and materials are shared: never dispose them
 * through the returned object.
 *
 * @param extra - What to wear, in which colour.
 * @param female - Built for a woman (a slimmer back).
 * @returns The bone to hang it on and the object, in metres (scale it into the bone's units).
 */
export function createAccessory(
  extra: AppearanceExtra,
  female: boolean,
): { bone: AccessoryBone; object: Object3D } {
  const object = new Group();
  object.name = `accessory:${extra.kind}`;
  const [lit, glowing] = accessoryGeometry(extra, female);
  const materials = characterMaterials();
  if (lit) object.add(new Mesh(lit, materials.body));
  if (glowing) object.add(new Mesh(glowing, materials.glow));
  return { bone: ACCESSORIES[extra.kind].bone, object };
}

/** Frees every accessory's merged geometry and forgets it; the next view builds them afresh. */
export function disposeAccessoryGeometries(): void {
  for (const pair of geometryCache.values())
    for (const geometry of pair) geometry?.dispose();
  geometryCache.clear();
}
