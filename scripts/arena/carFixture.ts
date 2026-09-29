/**
 * Small stand-ins for the Kenney Car Kit, built in code for the car pack's tests (no download):
 * an atlas with one colour per swatch (the red paint a gradient), and a boxy "car" in the Kit's
 * frame — x to the left, y up, z forward — with a body, lamps, a front plate, a roof light bar
 * and four wheels.
 */

import type { CarWheelNode } from "../../src/lib/cityArena/carManifest";
import {
  ATLAS_COLUMNS,
  ATLAS_ROWS,
  SWATCH,
  type Atlas,
  type SwatchKey,
} from "./carAtlas";
import { boxSoup, concatSoups } from "./carGeometry";
import type { CarModelSoups } from "./packCars";

/** Texels per swatch, each way. */
const SWATCH_TEXELS = 8;
/** Channels per pixel, and an opaque alpha. */
const RGBA = 4;
const OPAQUE = 255;

/** The colour every swatch but the gradient is filled with: its column and row, spread out. */
export function fixtureSwatchColour(column: number, row: number): number {
  return ((column * 15) << 16) | ((row * 60) << 8) | 0x40;
}

/** The red paint's gradient: this bright at the top, darker below. */
export const FIXTURE_PAINT_TOP = 0xff0000;
/** How much each texel row darkens the gradient. */
const GRADIENT_STEP = 0x100000;

/** An atlas of flat swatches, with the red paint a top-to-bottom gradient. */
export function fixtureAtlas(): Atlas {
  const width = ATLAS_COLUMNS * SWATCH_TEXELS;
  const height = ATLAS_ROWS * SWATCH_TEXELS;
  const data = new Uint8Array(width * height * RGBA);
  const [paintColumn, paintRow] = SWATCH.redPaint.split(":").map(Number);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const column = Math.floor(x / SWATCH_TEXELS);
      const row = Math.floor(y / SWATCH_TEXELS);
      const gradient = column === paintColumn && row === paintRow;
      const colour = gradient
        ? FIXTURE_PAINT_TOP - (y % SWATCH_TEXELS) * GRADIENT_STEP
        : fixtureSwatchColour(column, row);
      data.set(
        [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff, OPAQUE],
        (y * width + x) * RGBA,
      );
    }
  return { width, height, data };
}

/** A box in the Kit's frame. */
function box(
  at: [number, number, number],
  size: [number, number, number],
  swatch: SwatchKey,
): ReturnType<typeof boxSoup> {
  return boxSoup(at, size, swatch);
}

/** The fixture car's wheels: radius 0.3, 0.3 wide, axles 1 either side of the middle. */
const FIXTURE_WHEELS: readonly [CarWheelNode, number, number][] = [
  ["wheel-front-left", 0.6, 1],
  ["wheel-front-right", -0.6, 1],
  ["wheel-back-left", 0.6, -1],
  ["wheel-back-right", -0.6, -1],
];

/**
 * A boxy car in the Kit's frame, 2.6 long, 1.5 wide, 1.4 tall: a red body, headlamps and tail
 * lamps at its ends, a plate on its nose, a red and a blue lamp on its roof, four wheels.
 *
 * @returns Its body and wheels.
 */
export function fixtureCar(): CarModelSoups {
  const body = concatSoups([
    box([0, 0.75, 0], [1.4, 0.9, 2.6], SWATCH.redPaint),
    box([0.4, 0.9, 1.305], [0.3, 0.1, 0.01], SWATCH.headLamp),
    box([-0.4, 0.9, 1.305], [0.3, 0.1, 0.01], SWATCH.headLamp),
    box([0.4, 0.9, -1.305], [0.3, 0.1, 0.01], SWATCH.redLamp),
    box([-0.4, 0.9, -1.305], [0.3, 0.1, 0.01], SWATCH.redLamp),
    box([0, 0.5, 1.305], [0.4, 0.1, 0.01], SWATCH.light),
    box([0.2, 1.25, 0], [0.2, 0.1, 0.2], SWATCH.redLamp),
    box([-0.2, 1.25, 0], [0.2, 0.1, 0.2], SWATCH.blueLamp),
  ]);
  const wheels = FIXTURE_WHEELS.map(([node, x, z]) => ({
    node,
    soup: box([x, 0.3, z], [0.3, 0.6, 0.6], SWATCH.dark),
  }));
  return { body, wheels };
}
