/**
 * Landmark buildings with art of their own (Plan 10: the brewery). The art is a building seen
 * from directly above with its long side along the image's x axis; it is laid over the footprint
 * along the ring's longest edge, stretched to the footprint's length along that edge plus an
 * overhang for the eaves, and as wide as its own aspect says — the art decides how far a terrace
 * or a chimney's steam reaches past the walls. The terrace end of the art (its left) is laid at
 * the north or west end of the building, which is the street side of the house it was made for.
 */
import type { DecodedBuilding } from "../world/decode";
import type { Point } from "../world/projection";
import type { RasterContext } from "./canvasTypes";
import { longestEdgeAngle } from "./drawRoofs";
import type { PropSprite } from "./sprites";

/** Metres the art reaches past each end of the footprint along its length. */
export const LANDMARK_ART_OVERHANG_M = 0.5;

/** The box a ring occupies along and across a direction: its centre and the two extents. */
export type OrientedBox = {
  centre: Point;
  angle: number;
  length: number;
  width: number;
};

/**
 * The tightest box around a ring whose long side runs along the ring's longest edge, turned so
 * its length points down or east — never up or west — so the art's left end lands at the
 * north or west end of the building.
 *
 * @param ring - The footprint, metres.
 * @returns The box.
 */
export function orientedBox(ring: Point[]): OrientedBox {
  let angle = longestEdgeAngle(ring);
  // Fold the direction into the half-plane pointing east (or straight down): the art's left
  // end then lies at the west or north end.
  if (
    Math.cos(angle) < -1e-9 ||
    (Math.abs(Math.cos(angle)) <= 1e-9 && Math.sin(angle) < 0)
  )
    angle += Math.PI;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let minAlong = Infinity;
  let maxAlong = -Infinity;
  let minAcross = Infinity;
  let maxAcross = -Infinity;
  for (const [x, y] of ring) {
    const along = x * cos + y * sin;
    const across = -x * sin + y * cos;
    minAlong = Math.min(minAlong, along);
    maxAlong = Math.max(maxAlong, along);
    minAcross = Math.min(minAcross, across);
    maxAcross = Math.max(maxAcross, across);
  }
  const midAlong = (minAlong + maxAlong) / 2;
  const midAcross = (minAcross + maxAcross) / 2;
  return {
    centre: [
      midAlong * cos - midAcross * sin,
      midAlong * sin + midAcross * cos,
    ],
    angle,
    length: maxAlong - minAlong,
    width: maxAcross - minAcross,
  };
}

/**
 * Paints a landmark's art over its building.
 *
 * @param context - The chunk's context, in world metres.
 * @param building - The landmark's footprint.
 * @param sprite - The style's art.
 */
export function paintLandmarkArt(
  context: RasterContext,
  building: Pick<DecodedBuilding, "ring">,
  sprite: PropSprite,
): void {
  const box = orientedBox(building.ring);
  const length = box.length + 2 * LANDMARK_ART_OVERHANG_M;
  const width = (length * sprite.widthMetres) / sprite.lengthMetres;
  context.save();
  context.translate(box.centre[0], box.centre[1]);
  context.rotate(box.angle);
  context.drawImage(sprite.image, -length / 2, -width / 2, length, width);
  context.restore();
}
