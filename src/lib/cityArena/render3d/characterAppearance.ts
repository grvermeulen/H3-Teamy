/**
 * How each glTF character looks (spec §7, "Diversity"): the model, the colour of every palette
 * slot, a height and a few accessories. A pedestrian's appearance is derived from its id alone, so
 * every device dresses it alike and nothing goes on the wire. The player keeps the splash-screen
 * identity (bald, red shades, mint shorts, bead bracelet), other players wear their vest hue, and
 * officers wear the SWAT model in Dutch police navy. Pure.
 */
import {
  CHARACTER_MODEL_KEYS,
  type CharacterModelKey,
} from "../characterManifest";
import {
  DEFAULT_VEST_HUE,
  vestColour,
  type CharacterLook,
} from "./characterLooks";
import { idHash, idUnit } from "./idHash";

/** What a palette slot is on a model; slots without a role keep their own colour. */
export type SlotRole =
  | "skin"
  | "skinShade"
  | "hair"
  | "hairShade"
  | "brows"
  | "top"
  | "top2"
  | "bottom"
  | "shoes"
  | "suit"
  | "accent"
  | "vivid";

/** An accessory worn over the model, in its colour (a lens for sunglasses). */
export type AppearanceExtra = {
  kind: "cap" | "glasses" | "sunglasses" | "backpack" | "bracelet" | "badge";
  colour: number;
};

/** A character's appearance. */
export type Appearance = {
  model: CharacterModelKey;
  /** Palette slot → sRGB hex colour, replacing the model's own colour for that slot. */
  tints: Readonly<Record<string, number>>;
  /** Palette slots not drawn at all (the player's hair). */
  hidden: readonly string[];
  /** Uniform scale around 1. */
  scale: number;
  extras: readonly AppearanceExtra[];
};

/** Smallest and largest pedestrian scale. */
export const APPEARANCE_SCALE_MIN = 0.92;
export const APPEARANCE_SCALE_MAX = 1.08;

/** Eight skin tones, light to dark. */
export const SKIN_TONES: readonly number[] = [
  0xf3d5bd, 0xe8bf9c, 0xd9a37f, 0xc68d63, 0xb07850, 0x94603f, 0x74472d,
  0x553321,
];
/** Black, dark brown, brown, blond, red and grey hair. */
const HAIR_COLOURS: readonly number[] = [
  0x151210, 0x3b2616, 0x6b4527, 0xc9a45c, 0x8c3b1d, 0xa9a7a2,
];
/** Shirts, jumpers, jackets and dresses. */
const TOP_COLOURS: readonly number[] = [
  0x283158, 0xa3282a, 0x2f6b3a, 0xdca62a, 0x878787, 0xf2f2ee, 0x1c1c1e,
  0x5a8fc4, 0xf23c84, 0x7a4fa0, 0xd76b2a, 0x2a8a8a,
];
/** Jeans, chinos, skirts and shorts. */
const BOTTOM_COLOURS: readonly number[] = [
  0x3d5b8c, 0x27344f, 0x1c1c1e, 0x3e3a31, 0xb39b72, 0x5e5e62, 0x6b4a2e,
  0x2e3b2a,
];
/** Sneakers, leather and boots. */
const SHOE_COLOURS: readonly number[] = [
  0xe9e9e4, 0x151515, 0x5a3a22, 0x707070, 0xa3282a, 0x283158,
];
/** Office suits. */
const SUIT_COLOURS: readonly number[] = [
  0x1d2329, 0x22283a, 0x3a3a3a, 0x1c1c1e, 0x4a3b2c,
];
/** Ties and trims. */
const ACCENT_COLOURS: readonly number[] = [
  0x5a1420, 0x1f3f7a, 0x2f6b3a, 0x7a6a1c,
];
/** Dyed punk hair. */
const VIVID_COLOURS: readonly number[] = [
  0xd8243c, 0x28b0e0, 0x7ad83a, 0xe040c8, 0xf0d020,
];

/** Shades of a colour that the palettes derive: skin in shadow, hair roots, eyebrows. */
const SKIN_SHADE = 0.85;
const HAIR_SHADE = 0.7;
const BROW_SHADE = 0.6;

/** The player's warm brown skin, red lenses, mint shorts and bead bracelet (see `characterLooks`). */
const PLAYER_SKIN = 0x9a6445;
const PLAYER_LENS = 0x7a1010;
const MINT = 0x9fe0c4;
const PLAYER_BROWS = 0x2a1d14;
const PLAYER_BEADS = 0xd8b25a;
/** Dutch police navy, the darker navy of the gear, black boots and the gold badge. */
const POLICE_NAVY = 0x1f2a4c;
const POLICE_GEAR = 0x141b30;
const POLICE_BOOTS = 0x111111;
const POLICE_BADGE = 0xd8c27a;
/** Frames of ordinary glasses. */
const GLASSES_FRAME = 0x1a1a1a;

/** Skin on every part that shows it. */
const SKIN = { Skin: "skin", "Head/Skin": "skin" } as const;
const SKIN_AND_FEET = { ...SKIN, "Feet/Skin": "skin" } as const;

/** Which palette slot of each model plays which role (slot names from the pack's manifest). */
export const MODEL_SLOT_ROLES: Record<
  CharacterModelKey,
  Readonly<Record<string, SlotRole>>
> = {
  "casual-man": {
    ...SKIN,
    Skin_Darker: "skinShade",
    Hair: "hair",
    Eyebrows: "brows",
    LightBrown: "top",
    LightBlue: "bottom",
    Red_Dark: "shoes",
  },
  "business-man": {
    ...SKIN,
    Hair: "hair",
    Eyebrows: "brows",
    Suit: "suit",
    Tie: "accent",
  },
  "hoodie-man": {
    ...SKIN,
    Hair: "hair",
    Eyebrows: "brows",
    Purple: "top",
    "Feet/Purple": "top",
    LightBlue: "bottom",
  },
  "worker-man": {
    ...SKIN,
    Moustache: "hair",
    Eyebrows: "brows",
    LightBrown: "top",
    Brown: "bottom",
  },
  "punk-man": {
    ...SKIN_AND_FEET,
    Red: "vivid",
    Red_Dark: "vivid",
    Eyebrows: "brows",
    White: "top",
    Black: "top2",
    "Feet/Black": "shoes",
    LightBlue: "bottom",
  },
  "beach-man": {
    ...SKIN_AND_FEET,
    Hair: "hair",
    Eyebrows: "brows",
    LightBrown: "top",
    Red_Dark: "bottom",
    "Feet/Red_Dark": "shoes",
  },
  "farmer-man": {
    ...SKIN,
    Eyebrows: "brows",
    Brown: "top",
    LightBlue: "bottom",
    "Feet/Brown": "shoes",
  },
  swat: {
    Skin: "skin",
    Swat: "top",
    "Head/Swat": "top",
    Swat_Black: "top2",
    "Head/Swat_Black": "top2",
    "Feet/Swat_Black": "shoes",
  },
  "woman-a": {
    ...SKIN_AND_FEET,
    "Head/Red": "hair",
    Brown: "brows",
    LimeGreen: "top",
    "Feet/Red": "shoes",
  },
  "woman-b": {
    ...SKIN_AND_FEET,
    Hair_Blond: "hair",
    Hair_Brown: "hairShade",
    Brown: "brows",
    White: "top",
    Orange: "bottom",
    Grey: "shoes",
  },
  "punk-woman": {
    ...SKIN,
    "Head/Pink": "vivid",
    Brown: "brows",
    Pink: "top",
    Black: "bottom",
    "Feet/Black": "shoes",
  },
  "adventurer-woman": {
    ...SKIN,
    Hair_Brown: "hair",
    Brown: "brows",
    LightGreen: "top",
    Green: "top2",
    Brown_02: "bottom",
    "Feet/Brown_02": "shoes",
  },
  "hooded-woman": {
    ...SKIN,
    White: "hair",
    Brown: "brows",
    DarkBrown: "top",
    "Head/DarkBrown": "top",
    LightBrown: "top2",
    Black: "bottom",
    "Feet/LightBrown": "shoes",
  },
  "suit-woman": {
    ...SKIN_AND_FEET,
    Hair_Blond: "hair",
    Hair_Brown: "hairShade",
    Brown: "brows",
    Black: "suit",
    "Feet/Black": "shoes",
  },
  "worker-woman": {
    ...SKIN_AND_FEET,
    DarkBrown: "hair",
    Brown: "brows",
    White: "top",
    Brown_02: "bottom",
  },
};

/** Everyone in the street but the officers. */
const CITY_MODELS: readonly CharacterModelKey[] = CHARACTER_MODEL_KEYS.filter(
  (key) => key !== "swat",
);
/** Other players: a man or a woman by id, in a top that takes the vest hue. */
const OTHER_PLAYER_MODELS: readonly CharacterModelKey[] = [
  "hoodie-man",
  "woman-b",
];
/** Models whose hair a cap sits on without clipping (no hat, helmet or big hair of their own). */
const CAP_MODELS: ReadonlySet<CharacterModelKey> = new Set<CharacterModelKey>([
  "casual-man",
  "hoodie-man",
  "beach-man",
  "business-man",
]);

/** Salts naming each id-derived choice. */
const SALT = {
  model: 0x3a7c11,
  skin: 0x51e0b3,
  hair: 0x6c2d47,
  top: 0x1f9e25,
  top2: 0x7d4412,
  bottom: 0x2b8f6e,
  shoes: 0x49c3a1,
  suit: 0x5e2a90,
  accent: 0x0d6bb8,
  vivid: 0x731c5f,
  scale: 0x2c6f3d,
  cap: 0x4ab21c,
  glasses: 0x60d93e,
  backpack: 0x18e457,
} as const;

/** Chance of each accessory on a pedestrian. */
const CAP_CHANCE = 0.25;
const GLASSES_CHANCE = 0.2;
const BACKPACK_CHANCE = 0.2;
/** A pedestrian wears at most this many accessories. */
const MAX_PED_EXTRAS = 2;

/** One of `options`, picked by the id and a salt. */
function pick<T>(options: readonly T[], id: number, salt: number): T {
  return options[idHash(id, salt) % options.length];
}

/** An sRGB hex colour darkened by `factor`. */
function shade(colour: number, factor: number): number {
  const channel = (shift: number): number =>
    Math.round(((colour >> shift) & 0xff) * factor) << shift;
  return channel(16) | channel(8) | channel(0);
}

/** A colour for every role. */
type Outfit = Record<SlotRole, number>;

/** The colours an id dresses in; `skin` and `hair` fill in the shades derived from them. */
function outfitOf(id: number, overrides: Partial<Outfit> = {}): Outfit {
  const skin = overrides.skin ?? pick(SKIN_TONES, id, SALT.skin);
  const hair = overrides.hair ?? pick(HAIR_COLOURS, id, SALT.hair);
  return {
    skin,
    skinShade: shade(skin, SKIN_SHADE),
    hair,
    hairShade: shade(hair, HAIR_SHADE),
    brows: shade(hair, BROW_SHADE),
    top: pick(TOP_COLOURS, id, SALT.top),
    top2: pick(TOP_COLOURS, id, SALT.top2),
    bottom: pick(BOTTOM_COLOURS, id, SALT.bottom),
    shoes: pick(SHOE_COLOURS, id, SALT.shoes),
    suit: pick(SUIT_COLOURS, id, SALT.suit),
    accent: pick(ACCENT_COLOURS, id, SALT.accent),
    vivid: pick(VIVID_COLOURS, id, SALT.vivid),
    ...overrides,
  };
}

/** The model's slots coloured by an outfit. */
function tintsFor(
  model: CharacterModelKey,
  outfit: Outfit,
): Record<string, number> {
  const tints: Record<string, number> = {};
  for (const [slot, role] of Object.entries(MODEL_SLOT_ROLES[model]))
    tints[slot] = outfit[role];
  return tints;
}

/** True when the id's roll for a salt comes in under `chance`. */
function rolls(id: number, salt: number, chance: number): boolean {
  return idUnit(id, salt) < chance;
}

/** A pedestrian's accessories: a cap, glasses and a backpack by chance, at most two. */
function pedExtras(model: CharacterModelKey, id: number): AppearanceExtra[] {
  const extras: AppearanceExtra[] = [];
  if (CAP_MODELS.has(model) && rolls(id, SALT.cap, CAP_CHANCE))
    extras.push({ kind: "cap", colour: pick(TOP_COLOURS, id, SALT.cap) });
  if (rolls(id, SALT.glasses, GLASSES_CHANCE))
    extras.push({ kind: "glasses", colour: GLASSES_FRAME });
  if (rolls(id, SALT.backpack, BACKPACK_CHANCE))
    extras.push({
      kind: "backpack",
      colour: pick(TOP_COLOURS, id, SALT.backpack),
    });
  return extras.slice(0, MAX_PED_EXTRAS);
}

/**
 * The model a character of a look and id wears — the one {@link appearanceOf} picks, without
 * building the rest of the appearance (cheap enough to ask every frame).
 *
 * @param look - What the 2D view would draw.
 * @param id - The entity's id.
 * @returns The model.
 */
export function modelOf(look: CharacterLook, id: number): CharacterModelKey {
  if (look === "player") return "beach-man";
  if (look === "cop") return "swat";
  if (look === "otherPlayer")
    return OTHER_PLAYER_MODELS[Math.abs(id) % OTHER_PLAYER_MODELS.length];
  return pick(CITY_MODELS, id, SALT.model);
}

/** Nothing hidden. */
const NONE_HIDDEN: readonly string[] = [];
/** The player's hair goes: bald. */
const PLAYER_HIDDEN: readonly string[] = ["Hair"];

/**
 * The player: the beach model, bald (the hair is hidden), shirtless (the vest takes the skin),
 * mint shorts, barefoot (the flip-flops take the skin).
 */
function playerAppearance(): Appearance {
  const outfit = outfitOf(0, {
    skin: PLAYER_SKIN,
    hair: PLAYER_SKIN,
    brows: PLAYER_BROWS,
    top: PLAYER_SKIN,
    bottom: MINT,
    shoes: PLAYER_SKIN,
  });
  return {
    model: "beach-man",
    tints: tintsFor("beach-man", outfit),
    hidden: PLAYER_HIDDEN,
    scale: 1,
    extras: [
      { kind: "sunglasses", colour: PLAYER_LENS },
      { kind: "bracelet", colour: PLAYER_BEADS },
    ],
  };
}

/** An officer: police navy with darker gear and a badge; the skin varies by id. */
function copAppearance(id: number): Appearance {
  const outfit = outfitOf(id, {
    top: POLICE_NAVY,
    top2: POLICE_GEAR,
    shoes: POLICE_BOOTS,
  });
  return {
    model: "swat",
    tints: tintsFor("swat", outfit),
    hidden: NONE_HIDDEN,
    scale: 1,
    extras: [{ kind: "badge", colour: POLICE_BADGE }],
  };
}

/**
 * How a character looks. Pedestrians (and mission contacts) are dressed by id alone: model, skin,
 * hair, clothes, height and accessories.
 *
 * @param look - What the 2D view would draw; decides player, officer, other player or pedestrian.
 * @param id - The entity's id (for a contact, a stable hash of its id).
 * @param vestHue - Another player's vest hue in turns.
 * @returns The appearance.
 */
export function appearanceOf(
  look: CharacterLook,
  id: number,
  vestHue: number = DEFAULT_VEST_HUE,
): Appearance {
  if (look === "player") return playerAppearance();
  if (look === "cop") return copAppearance(id);
  const model = modelOf(look, id);
  if (look === "otherPlayer") {
    const outfit = outfitOf(id, {
      skin: PLAYER_SKIN,
      top: vestColour(vestHue),
    });
    return {
      model,
      tints: tintsFor(model, outfit),
      hidden: NONE_HIDDEN,
      scale: 1,
      extras: [],
    };
  }
  const scale =
    APPEARANCE_SCALE_MIN +
    idUnit(id, SALT.scale) * (APPEARANCE_SCALE_MAX - APPEARANCE_SCALE_MIN);
  return {
    model,
    tints: tintsFor(model, outfitOf(id)),
    hidden: NONE_HIDDEN,
    scale,
    extras: pedExtras(model, id),
  };
}

/**
 * A string naming an appearance: equal for equal appearances.
 *
 * @param appearance - The appearance.
 * @returns Its key.
 */
export function appearanceKey(appearance: Appearance): string {
  const tints = Object.entries(appearance.tints)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([slot, colour]) => `${slot}=${colour.toString(16)}`)
    .join(",");
  const extras = appearance.extras
    .map((extra) => `${extra.kind}:${extra.colour.toString(16)}`)
    .join(",");
  return `${appearance.model}|${appearance.scale.toFixed(3)}|${tints}|${extras}`;
}
