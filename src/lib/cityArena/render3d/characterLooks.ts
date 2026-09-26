/**
 * The cast's looks in 3D, translated from the 2D sprites (`public/arena/sprites/person-*.png`,
 * design spec §6.6). Colours are sampled from the sprites and lifted a little: the sprites are
 * painted for a night map seen from above, the 3D view is lit at dusk.
 */
import { Color, SRGBColorSpace } from "three";
import { pedLook } from "../sim/peds";

/** Every look a 3D character can wear. */
export type CharacterLook =
  | "player"
  | "otherPlayer"
  | "ped1"
  | "ped2"
  | "ped3"
  | "ped4"
  | "ped5"
  | "ped6"
  | "cop";

/** Body frame: the width of the shoulders and the chunkiness of the limbs. */
export type Build = "broad" | "average" | "slim";

/** Hair on the head; `bald` shows the scalp. */
export type HairStyle =
  { style: "bald" } | { style: "short" | "ponytail"; colour: number };

/** A top or a bottom. */
export type Garment = {
  /** sRGB hex colour. */
  colour: number;
  /**
   * How far it covers the limbs: for a top the arms (sleeveless, short or long sleeves), for a
   * bottom the legs (shorts or full length). `none` leaves the limbs bare.
   */
  reach: "none" | "short" | "full";
  /** For a top: how far its hem hangs below the belt, metres (a coat reaches the thighs). */
  hem?: number;
};

/** Accessories and details layered over the body. */
export type Extra =
  | { kind: "sunglasses"; frame: number; lens: number }
  | { kind: "goatee"; colour: number }
  | { kind: "muscles"; colour: number }
  | { kind: "tattoo"; colour: number }
  | { kind: "bracelet"; colours: readonly number[] }
  | { kind: "vest"; trim: number }
  | { kind: "backpack"; colour: number; strap: number }
  | { kind: "zip"; colour: number }
  | { kind: "flatCap"; colour: number }
  | { kind: "hood"; colour: number }
  | { kind: "pouch"; colour: number; cord: number }
  | { kind: "buttons"; colour: number }
  | { kind: "collar"; shirt: number; tie: number }
  | { kind: "policeCap"; colour: number; peak: number; badge: number }
  | { kind: "bands"; colour: number }
  | { kind: "belt"; colour: number }
  | { kind: "holster"; colour: number }
  | { kind: "sneakers"; sole: number }
  | { kind: "hairTie"; colour: number };

/** Everything the rig needs to dress a character. */
export type LookSpec = {
  build: Build;
  /** Standing height to the crown, metres. */
  height: number;
  /** sRGB hex skin tone. */
  skin: number;
  hair: HairStyle;
  top: Garment;
  bottom: Garment;
  /** sRGB hex shoe colour; the skin tone for bare feet. */
  shoes: number;
  extras: Extra[];
};

/** Height of everyone but the player's build, metres. */
const STANDARD_HEIGHT_M = 1.8;
/** The player is the tallest in town. */
const PLAYER_HEIGHT_M = 1.85;

/** The player's warm brown skin. */
const PLAYER_SKIN = 0x9a6445;
/** The red lenses of the player's shades; drawn unlit, as if they glow. */
const PLAYER_LENS = 0x7a1010;
/** The player's mint shorts. */
const MINT = 0x9fe0c4;
/** Dutch police hi-vis yellow. */
const HI_VIS = 0xd7ff1f;
/** Clean white sneakers. */
const SNEAKER_WHITE = 0xe9e9e4;
/** A sneaker's pale rubber sole. */
const SOLE_LIGHT = 0xc9c5bb;
/** Near-black for trousers, shoes and leggings. */
const NEAR_BLACK = 0x1c1c1e;

/** The player: bald, shirtless and broad, in red shades and mint shorts, barefoot. */
const PLAYER: LookSpec = {
  build: "broad",
  height: PLAYER_HEIGHT_M,
  skin: PLAYER_SKIN,
  hair: { style: "bald" },
  top: { colour: PLAYER_SKIN, reach: "none" },
  bottom: { colour: MINT, reach: "short" },
  shoes: PLAYER_SKIN,
  extras: [
    { kind: "muscles", colour: 0x94603f },
    { kind: "sunglasses", frame: 0x141414, lens: PLAYER_LENS },
    { kind: "goatee", colour: 0x8e8c86 },
    { kind: "tattoo", colour: 0x2f3348 },
    { kind: "bracelet", colours: [0x5b3a1e, 0xd8b25a, 0x2a2a2a, 0xa8522a] },
  ],
};

/** The 3D looks. `otherPlayer` is the player's build in a vest whose hue the caller picks. */
export const LOOKS: Record<CharacterLook, LookSpec> = {
  player: PLAYER,
  otherPlayer: {
    ...PLAYER,
    extras: [...PLAYER.extras, { kind: "vest", trim: 0x1d1d22 }],
  },
  ped1: {
    build: "average",
    height: STANDARD_HEIGHT_M,
    skin: 0xd9a37f,
    hair: { style: "short", colour: 0x4a2f1f },
    top: { colour: 0x283158, reach: "full", hem: 0.04 },
    bottom: { colour: 0x3d5b8c, reach: "full" },
    shoes: SNEAKER_WHITE,
    extras: [
      { kind: "zip", colour: 0x8c93b0 },
      { kind: "backpack", colour: 0xa3282a, strap: 0x2a1c1c },
      { kind: "sneakers", sole: SOLE_LIGHT },
    ],
  },
  ped2: {
    build: "average",
    height: STANDARD_HEIGHT_M,
    skin: 0xd6a88a,
    hair: { style: "short", colour: 0xa9a7a2 },
    top: { colour: 0x5e5838, reach: "full", hem: 0.3 },
    bottom: { colour: 0x3e3a31, reach: "full" },
    shoes: 0x5a3a22,
    extras: [
      { kind: "flatCap", colour: 0x6c6c6a },
      { kind: "buttons", colour: 0x2c2718 },
    ],
  },
  ped3: {
    build: "average",
    height: STANDARD_HEIGHT_M,
    skin: 0xc68d63,
    hair: { style: "short", colour: 0x151515 },
    top: { colour: 0xdca62a, reach: "full", hem: 0.26 },
    bottom: { colour: 0x27272a, reach: "full" },
    shoes: NEAR_BLACK,
    extras: [
      { kind: "hood", colour: 0xdca62a },
      { kind: "buttons", colour: 0x6b4c0e },
    ],
  },
  ped4: {
    build: "average",
    height: STANDARD_HEIGHT_M,
    skin: 0xb07850,
    hair: { style: "short", colour: 0x1a1512 },
    top: { colour: 0x878787, reach: "full", hem: 0.08 },
    bottom: { colour: NEAR_BLACK, reach: "full" },
    shoes: SNEAKER_WHITE,
    extras: [
      { kind: "hood", colour: 0x878787 },
      { kind: "pouch", colour: 0x707070, cord: 0xeaeaea },
      { kind: "sneakers", sole: SOLE_LIGHT },
    ],
  },
  ped5: {
    build: "average",
    height: STANDARD_HEIGHT_M,
    skin: 0xe2b393,
    hair: { style: "short", colour: 0x111111 },
    top: { colour: 0x2a2a2e, reach: "full", hem: 0.12 },
    bottom: { colour: 0x222225, reach: "full" },
    shoes: 0x0f0f10,
    extras: [
      { kind: "collar", shirt: 0xf2f2ee, tie: 0x5a1420 },
      { kind: "buttons", colour: 0x111113 },
    ],
  },
  ped6: {
    build: "slim",
    height: STANDARD_HEIGHT_M,
    skin: 0xc28c5a,
    hair: { style: "ponytail", colour: 0xd9b467 },
    top: { colour: 0xf23c84, reach: "none" },
    bottom: { colour: 0x19191b, reach: "full" },
    shoes: 0x7cff2e,
    extras: [
      { kind: "hairTie", colour: 0xf23c84 },
      { kind: "sneakers", sole: 0xf4f4f0 },
    ],
  },
  cop: {
    build: "broad",
    height: STANDARD_HEIGHT_M,
    skin: 0xd6a07a,
    hair: { style: "short", colour: 0x3a2a1e },
    top: { colour: 0x1f2a4c, reach: "full", hem: 0.02 },
    bottom: { colour: 0x1b2442, reach: "full" },
    shoes: 0x111111,
    extras: [
      { kind: "policeCap", colour: 0x1b2442, peak: 0x0c0c0e, badge: 0xd8c27a },
      { kind: "bands", colour: HI_VIS },
      { kind: "belt", colour: 0x121212 },
      { kind: "holster", colour: 0x0e0e0e },
    ],
  },
};

/**
 * The look of a pedestrian: `ped1`…`ped6` by id, exactly as the 2D view picks its sprite.
 *
 * @param pedId - The pedestrian's id.
 * @returns Its look.
 */
export function pedLookOf(pedId: number): CharacterLook {
  return `ped${pedLook(pedId) + 1}` as CharacterLook;
}

/** Vest hue (turns) for another player when the caller gives none: a clear blue. */
export const DEFAULT_VEST_HUE = 0.58;
/** Vest saturation: bright enough to tell friends apart at a distance. */
const VEST_SATURATION = 0.75;
/** Vest lightness. */
const VEST_LIGHTNESS = 0.5;

/**
 * The colour of a vest of the given hue.
 *
 * @param hue - Hue in turns; values outside 0…1 wrap.
 * @returns An sRGB hex colour.
 */
export function vestColour(hue: number): number {
  return new Color()
    .setHSL(hue, VEST_SATURATION, VEST_LIGHTNESS, SRGBColorSpace)
    .getHex();
}
