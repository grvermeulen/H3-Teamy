/**
 * The car pack's sources (spec §8): each vehicle kind drawn with a Kenney Car Kit model, the model
 * it is packed from, how its body is painted, and what the pack adds or recolours on it.
 */

import type { CarKind } from "../../src/lib/cityArena/carManifest";
import { SWATCH, type SwatchKey } from "./carAtlas";

/** The tractor's rims, yellow as on its 2D sprite. */
const TRACTOR_RIM = 0xe0b52a;
/** Window glass, darker than the Kit's pale blue so the evening town does not light it up. */
export const CAR_GLASS = 0x2a3a4c;

/** A small lamp the pack adds where a Kit model has none: a box in the Kit's frame. */
export type AddedLamp = {
  /** Middle of the box, in the Kit's frame (x left, y up, z forward). */
  at: [number, number, number];
  /** Size across, up and along. */
  size: [number, number, number];
  tail: boolean;
};

/** One vehicle kind and the Kit model it is packed from. */
export type CarSource = {
  kind: CarKind;
  /** The model's name in the Kit. */
  model: string;
  /** Its title, for the credits. */
  title: string;
  /**
   * The swatches its body is painted from, tinted per car in the view; the first is the Kit's own
   * body colour.
   */
  paint: readonly SwatchKey[];
  /** Its red and blue roof lamps are the light bar's lenses. */
  lightBar?: boolean;
  /** Measure the flank between the arches for the police livery. */
  livery?: boolean;
  /** Swatches its wheels are drawn in another colour, sRGB hex. */
  wheelRecolour?: Partial<Record<SwatchKey, number>>;
  /** Lamps the Kit model lacks. */
  addedLamps?: readonly AddedLamp[];
};

/** Headlamps on the tractor's bonnet front and tail lamps on its rear, which the Kit omits. */
const TRACTOR_LAMPS: readonly AddedLamp[] = [
  { at: [0.2, 0.9, 1.02], size: [0.12, 0.08, 0.02], tail: false },
  { at: [-0.2, 0.9, 1.02], size: [0.12, 0.08, 0.02], tail: false },
  { at: [0.5, 0.95, -0.89], size: [0.1, 0.07, 0.02], tail: true },
  { at: [-0.5, 0.95, -0.89], size: [0.1, 0.07, 0.02], tail: true },
];

/** Every kind drawn with a Kit model, as the probe found them (see `3D-MODE.md`, "Cars"). */
export const CAR_SOURCES: readonly CarSource[] = [
  {
    kind: "compact",
    model: "hatchback-sports",
    title: "Hatchback Sports",
    paint: [SWATCH.greenPaint],
  },
  { kind: "sedan", model: "sedan", title: "Sedan", paint: [SWATCH.redPaint] },
  {
    kind: "sport",
    model: "sedan-sports",
    title: "Sedan Sports",
    paint: [SWATCH.redPaint],
  },
  {
    kind: "police",
    model: "police",
    title: "Police",
    // White all over, as Dutch police cars are: the Kit's blue-grey upper body too.
    paint: [SWATCH.light, SWATCH.blueGrey],
    lightBar: true,
    livery: true,
  },
  { kind: "van", model: "van", title: "Van", paint: [SWATCH.bluePaint] },
  {
    kind: "pickup",
    model: "truck",
    title: "Truck",
    paint: [SWATCH.greenPaint],
  },
  {
    kind: "tractor",
    model: "tractor",
    title: "Tractor",
    paint: [SWATCH.blueGrey],
    wheelRecolour: { [SWATCH.rim]: TRACTOR_RIM },
    addedLamps: TRACTOR_LAMPS,
  },
];
