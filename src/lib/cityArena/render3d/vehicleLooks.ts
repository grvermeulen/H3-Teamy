/**
 * What every vehicle model shares whichever way it is built — procedurally (`vehicleModels.ts`)
 * or from the Kenney Car Kit (`gltfVehicle.ts`): each kind's height, its body colour, and the
 * police light bar's lens materials.
 */
import type { MeshLambertMaterial } from "three";
import type { VehicleKind } from "../sim/types";
import {
  CAR_BODY_COLOURS,
  POLICE_LIGHT_BLUE,
  POLICE_LIGHT_RED,
} from "../render/palette";
import { glowMaterial, matteMaterial } from "./vehicleParts";
import { LIGHT_BAR_HEIGHT_M } from "./vehicleShapes";

/** Roof height of the sedan, which the police car shares under its light bar. */
const SEDAN_ROOF_M = 1.45;

/** Overall height of each kind, ground to its highest part (roof, light bar, roof units, hatch). */
export const VEHICLE_HEIGHT_M: Readonly<Record<VehicleKind, number>> = {
  compact: 1.52,
  sedan: SEDAN_ROOF_M,
  sport: 1.18,
  police: SEDAN_ROOF_M + LIGHT_BAR_HEIGHT_M,
  van: 2.25,
  pickup: 1.85,
  bus: 3.1,
  oldtimer: 1.6,
  tractor: 2.6,
  tank: 2.25,
};

/**
 * How tall a kind's model stands, metres.
 *
 * @param kind - The vehicle kind.
 * @returns Ground to the highest part.
 */
export function vehicleHeight(kind: VehicleKind): number {
  return VEHICLE_HEIGHT_M[kind];
}

/** Kinds that keep their own livery whatever their colour index, as their 2D sprites do. */
const FIXED_BODY_COLOUR: Partial<Record<VehicleKind, number>> = {
  police: 0xf2f2ee,
  bus: 0xe8e8e4,
  tractor: 0x3f7040,
  tank: 0x4a5a33,
};

/** A `#rrggbb` palette colour as a number. */
function hexOf(css: string): number {
  return Number.parseInt(css.slice(1), 16);
}

/**
 * The body colour of a vehicle: its kind's livery, or the palette colour its index picks.
 *
 * @param kind - The vehicle kind.
 * @param colour - `VehicleState.colour`, an index into `CAR_BODY_COLOURS`.
 * @returns The colour, `0xrrggbb`.
 */
export function bodyColour(kind: VehicleKind, colour: number): number {
  return (
    FIXED_BODY_COLOUR[kind] ??
    hexOf(CAR_BODY_COLOURS[colour % CAR_BODY_COLOURS.length])
  );
}

/** Lens colours of the light bar: blue on the left, red on the right, and their unlit tint. */
const LENS_COLOURS = {
  left: { lit: hexOf(POLICE_LIGHT_BLUE), dark: 0x1c2a4d },
  right: { lit: hexOf(POLICE_LIGHT_RED), dark: 0x4a1c1c },
} as const;

/**
 * The material of one light-bar lens.
 *
 * @param side - `left` is the blue lens, `right` the red one.
 * @param lit - Whether it is flashing on.
 * @returns A shared material: emissive when lit, dull otherwise.
 */
export function lensMaterial(
  side: keyof typeof LENS_COLOURS,
  lit: boolean,
): MeshLambertMaterial {
  const colours = LENS_COLOURS[side];
  return lit ? glowMaterial(colours.lit) : matteMaterial(colours.dark);
}
