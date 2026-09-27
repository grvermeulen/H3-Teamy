/**
 * Trim every vehicle kind shares: dark wheel arches over the wheels, door shut lines along a car's
 * flanks, and yellow Dutch number plates (with the blue EU strip) front and back. Each adds its
 * parts to a kit in the vehicle's frame — x forward, y up, z to the right, metres.
 */
import { BoxGeometry, type BufferGeometry } from "three";
import { cylinder, slab } from "./vehicleParts";
import type { Axle, Kit } from "./vehicleShapes";

/** The arch's dark: nearly black, a little warmer than the tyres. */
const ARCH_COLOUR = 0x0f0f11;
/** How much bigger than its wheel an arch is, how thick, and how far it stands off the side, metres. */
const ARCH = { margin: 0.07, depth: 0.03, proud: 0.012, segments: 14 };
/** An arch's flat foot, as a share of its wheel's radius above the ground: the wheel hides it. */
const ARCH_FOOT_SHARE = 0.55;
/** A door shut line: its width and depth, how far off the flank, and the margin top and bottom, metres. */
const DOOR_LINE = { width: 0.012, depth: 0.012, proud: 0.004, margin: 0.06 };
const DOOR_LINE_COLOUR = 0x121315;
/** A Dutch plate: width, height, depth, and how far proud of the bumper, metres. */
const PLATE = { width: 0.52, height: 0.11, depth: 0.01, proud: 0.005 };
/** The blue EU strip's width at the plate's left end, metres. */
const EU_STRIP_M = 0.055;
const EU_BLUE = 0x23469e;

/** A plate's colours, and whether it carries the EU strip. */
type PlateLook = { plate: number; letters: number; euStrip: boolean };

/** Today's yellow plate with black letters, and the dark blue one with white letters of old cars. */
export const PLATE_LOOKS = {
  modern: { plate: 0xf2c01c, letters: 0x1a1a1c, euStrip: true },
  classic: { plate: 0x1f2d5c, letters: 0xe6e4da, euStrip: false },
} as const satisfies Record<string, PlateLook>;
/** The plate's three groups of characters: each group's width, their gap and height share. */
const LETTER_GROUP = { width: 0.1, gap: 0.035, height: 0.62, depth: 0.004 };

/** Flattens a geometry's underside at `floor`, so an arch never reaches the ground. */
function flattenBelow(geometry: BufferGeometry, floor: number): BufferGeometry {
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index++)
    position.setY(index, Math.max(floor, position.getY(index)));
  return geometry;
}

/**
 * Dark arches over both wheels of every axle, just proud of the vehicle's sides and flat-footed
 * above the ground: the wheel hides their lower part, so each reads as the cut-out it turns in.
 *
 * @param kit - The vehicle.
 * @param axles - Its axles.
 * @param side - How far each side's face is from the centre line, metres.
 */
export function addWheelArches(
  kit: Kit,
  axles: readonly Axle[],
  side: number,
): void {
  for (const axle of axles)
    for (const sign of [-1, 1]) {
      const arch = cylinder({
        radius: axle.wheel.radius + ARCH.margin,
        length: ARCH.depth,
        axis: "z",
        at: [axle.x, axle.wheel.radius, sign * (side + ARCH.proud)],
        segments: ARCH.segments,
      });
      kit.tint(
        flattenBelow(arch, axle.wheel.radius * ARCH_FOOT_SHARE),
        ARCH_COLOUR,
      );
    }
}

/**
 * Door shut lines up a car's flanks at the given stations along the body, leaning in with the
 * flank from the sill to the belt.
 *
 * @param kit - The vehicle.
 * @param stations - Where each line runs, metres along the body.
 * @param flank - The sill and belt heights, the side's distance at the sill and its lean in by the belt.
 */
export function addDoorLines(
  kit: Kit,
  stations: readonly number[],
  flank: { sill: number; belt: number; side: number; lean: number },
): void {
  const height = flank.belt - flank.sill - 2 * DOOR_LINE.margin;
  const angle = Math.atan2(flank.lean, flank.belt - flank.sill);
  const middle = (flank.sill + flank.belt) / 2;
  const reach = flank.side - flank.lean / 2 + DOOR_LINE.proud;
  for (const x of stations)
    for (const sign of [-1, 1]) {
      const line = new BoxGeometry(DOOR_LINE.width, height, DOOR_LINE.depth)
        .rotateX(-sign * angle)
        .translate(x, middle, sign * reach);
      kit.tint(line, DOOR_LINE_COLOUR);
    }
}

/** Where one plate sits: the front (+1) or back (−1), its face along the body and its middle's height. */
type PlateSpot = { end: 1 | -1; face: number; height: number };

/** One plate with its lettering and, when its look has one, the EU strip on the left. */
function addPlate(kit: Kit, spot: PlateSpot, look: PlateLook): void {
  const { end, height } = spot;
  const outer = spot.face + end * PLATE.proud;
  const x: [number, number] =
    end > 0 ? [outer - PLATE.depth, outer] : [outer, outer + PLATE.depth];
  const y: [number, number] = [
    height - PLATE.height / 2,
    height + PLATE.height / 2,
  ];
  kit.tint(slab({ x, y, width: PLATE.width }), look.plate);
  const front: [number, number] =
    end > 0
      ? [outer, outer + LETTER_GROUP.depth]
      : [outer - LETTER_GROUP.depth, outer];
  const strip = look.euStrip ? EU_STRIP_M : 0;
  if (look.euStrip) {
    const z = end * (PLATE.width / 2 - strip / 2);
    kit.tint(slab({ x: front, y, width: strip, z }), EU_BLUE);
  }
  const letterHeight = PLATE.height * LETTER_GROUP.height;
  const letterY: [number, number] = [
    height - letterHeight / 2,
    height + letterHeight / 2,
  ];
  const middle = -end * (strip / 2);
  const pitch =
    (LETTER_GROUP.width + LETTER_GROUP.gap) *
    ((PLATE.width - strip) / PLATE.width);
  for (const step of [-1, 0, 1]) {
    const z = middle + step * pitch;
    kit.tint(
      slab({ x: front, y: letterY, width: LETTER_GROUP.width, z }),
      look.letters,
    );
  }
}

/**
 * Dutch number plates on the front and back of a vehicle, their faces just proud of the vehicle's
 * ends; `null` leaves an end without one.
 *
 * @param kit - The vehicle.
 * @param heights - Each plate's middle height, metres, or null.
 * @param look - Yellow modern plates unless an old car wears the classic blue ones.
 */
export function addPlates(
  kit: Kit,
  heights: { front: number | null; rear: number | null },
  look: PlateLook = PLATE_LOOKS.modern,
): void {
  const face = kit.length / 2;
  if (heights.front !== null)
    addPlate(kit, { end: 1, face, height: heights.front }, look);
  if (heights.rear !== null)
    addPlate(kit, { end: -1, face: -face, height: heights.rear }, look);
}
