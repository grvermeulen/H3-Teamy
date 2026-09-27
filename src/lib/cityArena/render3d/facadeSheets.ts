/**
 * The façade colourways of the 3D city and which one a building wears. Each sheet is one finish
 * in one colourway — red, brown, yellow and grey-blue brick, five plaster tones, modern panels,
 * concrete and glass — painted into the façade atlas (`facadeAtlas.ts`) with its own upper floors,
 * ground floor with doors, and a plain stretch of wall for gables.
 *
 * The choice is deterministic: a building's finish follows its size and storeys as before, and its
 * colourway follows the block it stands in (a 36 m grid cell), so a row of terraced houses built
 * together shares its brick; a quarter of the buildings pick their own by their structure id.
 */
import { polygonArea } from "../mapBuild/geometry";
import { TILED_ROOF_MAX_AREA_M2 } from "../render/drawRoofs";
import type { DecodedBuilding } from "../world/decode";
import { idUnit } from "./idHash";

/** How a wall is finished. */
export type FacadeFinish = "brick" | "plaster" | "panel" | "concrete" | "glass";

/** Every {@link FacadeFinish}, in a stable order. */
export const FACADE_FINISHES: readonly FacadeFinish[] = [
  "brick",
  "plaster",
  "panel",
  "concrete",
  "glass",
];

/** One finish in one colourway: the colours the atlas paints it in (CSS hex). */
export type FacadeSheet = {
  key: string;
  finish: FacadeFinish;
  /** The wall itself: brick face, plaster, panel or concrete. */
  wall: string;
  /** Darker bricks, panel accents and the plinth. */
  accent: string;
  /** Mortar or the joints between panels. */
  joint: string;
  /** Window frames. */
  frame: string;
  /** Window sills; `null` for none (glass). */
  sill: string | null;
  /** The front door. */
  door: string;
};

/** Every sheet in atlas order; a building's sheet is an index into it. */
export const FACADE_SHEETS: readonly FacadeSheet[] = [
  {
    key: "brickRed",
    finish: "brick",
    wall: "#7a3b2b",
    accent: "#5f2d20",
    joint: "#86786c",
    frame: "#e2ddd0",
    sill: "#a9a296",
    door: "#2f4a36",
  },
  {
    key: "brickBrown",
    finish: "brick",
    wall: "#5e3c2c",
    accent: "#4a2d20",
    joint: "#7c6d60",
    frame: "#ddd6c6",
    sill: "#9e978a",
    door: "#6b1f1f",
  },
  {
    key: "brickYellow",
    finish: "brick",
    wall: "#a88d58",
    accent: "#8f7646",
    joint: "#bdb3a2",
    frame: "#f0ece2",
    sill: "#b8b1a4",
    door: "#23324a",
  },
  {
    key: "brickGrey",
    finish: "brick",
    wall: "#5b6068",
    accent: "#4a4f57",
    joint: "#8a8d92",
    frame: "#e9e6de",
    sill: "#a4a29c",
    door: "#1f1f22",
  },
  {
    key: "plasterWhite",
    finish: "plaster",
    wall: "#b5b0a6",
    accent: "#8d887d",
    joint: "#9d988d",
    frame: "#3a3a36",
    sill: "#cfc9bc",
    door: "#2b3f58",
  },
  {
    key: "plasterCream",
    finish: "plaster",
    wall: "#b3a47f",
    accent: "#8f8263",
    joint: "#9f9270",
    frame: "#f1ede3",
    sill: "#d2cab6",
    door: "#5c2a24",
  },
  {
    key: "plasterGrey",
    finish: "plaster",
    wall: "#8e8c87",
    accent: "#6f6d68",
    joint: "#7e7c77",
    frame: "#e6e3db",
    sill: "#b9b6ae",
    door: "#2e4b3a",
  },
  {
    key: "plasterOchre",
    finish: "plaster",
    wall: "#a98a58",
    accent: "#866c44",
    joint: "#977b4e",
    frame: "#f0ebdf",
    sill: "#c9bea6",
    door: "#233a52",
  },
  {
    key: "plasterSage",
    finish: "plaster",
    wall: "#8f9a83",
    accent: "#707a66",
    joint: "#808a74",
    frame: "#f2efe6",
    sill: "#c3c6b8",
    door: "#4a2c22",
  },
  {
    key: "panel",
    finish: "panel",
    wall: "#3c4046",
    accent: "#7a5a3c",
    joint: "#2c2f34",
    frame: "#202326",
    sill: "#55595f",
    door: "#6b6f75",
  },
  {
    key: "concrete",
    finish: "concrete",
    wall: "#61656a",
    accent: "#6c7075",
    joint: "#4d5156",
    frame: "#2f3236",
    sill: "#4b4f54",
    door: "#3a3e44",
  },
  {
    key: "glass",
    finish: "glass",
    wall: "#2b3c4f",
    accent: "#1f2b38",
    joint: "#18202a",
    frame: "#18202a",
    sill: null,
    door: "#18202a",
  },
];

/** The sheets of each finish, by index into {@link FACADE_SHEETS}. */
const SHEETS_OF: Record<FacadeFinish, number[]> = {
  brick: [],
  plaster: [],
  panel: [],
  concrete: [],
  glass: [],
};
FACADE_SHEETS.forEach((sheet, index) => SHEETS_OF[sheet.finish].push(index));

/** How often each brick colourway is laid, in sheet order: red, brown, yellow, grey-blue. */
const BRICK_WEIGHTS: readonly number[] = [0.4, 0.3, 0.17, 0.13];
/** From this many storeys a building is a tower: glass, concrete or panels. */
const TOWER_MIN_LEVELS = 5;
/** A tower needs this footprint to be a glass office rather than a concrete block, m². */
const GLASS_MIN_AREA_M2 = 400;
/** Share of the big towers clad in glass. */
const GLASS_TOWER_SHARE = 0.5;
/** A low building this big is a shed, a hall or a shop box, m². */
const INDUSTRIAL_MIN_AREA_M2 = 1200;
/** From this many storeys a building bigger than a house is a block of flats. */
const FLATS_MIN_LEVELS = 3;
/** Shares of the blocks of flats in brick and in panels; the rest are concrete. */
const FLATS_BRICK_SHARE = 0.45;
const FLATS_PANEL_SHARE = 0.3;
/** Share of the houses in brick; the rest are plastered, as in a Dutch street. */
const BRICK_HOUSE_SHARE = 0.65;
/** Share of the non-glass towers and halls clad in panels rather than concrete. */
const PANEL_SHARE = 0.5;
/** Size of the grid cell whose buildings share a colourway, metres. */
const BLOCK_GRID_M = 36;
/** Share of the buildings that pick their colourway by their own id instead of their block's. */
const OWN_TONE_SHARE = 0.25;
/** Salts naming each seeded choice about a building's façade. */
const FINISH_SALT = 0x51;
const HOUSE_FINISH_SALT = 0x59;
const TONE_SALT = 0x5a;
const OWN_TONE_SALT = 0x5b;
/** Keeps a block's grid coordinates apart when they are packed into one hash key. */
const BLOCK_KEY_STRIDE = 65536;

/** A number in [0, 1) shared by every building whose centre lies in the same grid cell. */
function blockUnit(building: DecodedBuilding, salt: number): number {
  const { bounds } = building;
  const gx = Math.floor((bounds.minX + bounds.maxX) / 2 / BLOCK_GRID_M);
  const gy = Math.floor((bounds.minY + bounds.maxY) / 2 / BLOCK_GRID_M);
  const key = (gx * BLOCK_KEY_STRIDE + gy) >>> 0;
  return idUnit(key, salt);
}

/**
 * A number in [0, 1) for one choice about a building's look: its block's (shared with every
 * building in its grid cell), or — for a quarter of the buildings — its own.
 */
function lookUnit(building: DecodedBuilding, salt: number): number {
  const own = idUnit(building.structureId, OWN_TONE_SALT) < OWN_TONE_SHARE;
  return own ? idUnit(building.structureId, salt) : blockUnit(building, salt);
}

/**
 * The finish a building's size and storeys give it: houses brick or plaster (as their block's
 * houses mostly are), flats brick, panels or concrete, big halls and towers panels or concrete
 * (big towers half glass) seeded by their id, landmarks brick.
 *
 * @param building - The building.
 * @returns Its finish.
 */
export function facadeFinishOf(building: DecodedBuilding): FacadeFinish {
  const pick = (share: number): boolean =>
    idUnit(building.structureId, FINISH_SALT) < share;
  if (building.landmark) return "brick";
  const area = polygonArea(building.ring);
  if (building.levels >= TOWER_MIN_LEVELS) {
    if (area >= GLASS_MIN_AREA_M2 && pick(GLASS_TOWER_SHARE)) return "glass";
    return idUnit(building.structureId, TONE_SALT) < PANEL_SHARE
      ? "panel"
      : "concrete";
  }
  if (area >= INDUSTRIAL_MIN_AREA_M2) {
    return idUnit(building.structureId, TONE_SALT) < PANEL_SHARE
      ? "panel"
      : "concrete";
  }
  if (building.levels >= FLATS_MIN_LEVELS && area > TILED_ROOF_MAX_AREA_M2) {
    const roll = idUnit(building.structureId, FINISH_SALT);
    if (roll < FLATS_BRICK_SHARE) return "brick";
    return roll < FLATS_BRICK_SHARE + FLATS_PANEL_SHARE ? "panel" : "concrete";
  }
  return lookUnit(building, HOUSE_FINISH_SALT) < BRICK_HOUSE_SHARE
    ? "brick"
    : "plaster";
}

/** The index a unit value picks from cumulative weights. */
function weightedPick(unit: number, weights: readonly number[]): number {
  let sum = 0;
  for (let index = 0; index < weights.length; index++) {
    sum += weights[index];
    if (unit < sum) return index;
  }
  return weights.length - 1;
}

/**
 * The sheet a building's walls are painted with, as an index into {@link FACADE_SHEETS}: its
 * finish (see {@link facadeFinishOf}) in a colourway shared by its block, or — for a quarter of
 * the buildings — its own. Landmarks are red brick.
 *
 * @param building - The building.
 * @returns An index in `[0, FACADE_SHEETS.length)`.
 */
export function facadeSheetOf(building: DecodedBuilding): number {
  const finish = facadeFinishOf(building);
  const sheets = SHEETS_OF[finish];
  if (building.landmark || sheets.length === 1) return sheets[0];
  const unit = lookUnit(building, TONE_SALT);
  if (finish === "brick") return sheets[weightedPick(unit, BRICK_WEIGHTS)];
  return sheets[Math.floor(unit * sheets.length)];
}
