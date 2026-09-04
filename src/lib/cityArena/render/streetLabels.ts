import type { Rect } from "../mapBuild/geometry";
import type { DecodedRoad } from "../world/decode";

/** Roads shorter than this get no label. */
export const LABEL_MIN_SEGMENT_M = 40;
/** Distance between repeated labels along one road piece. */
export const LABEL_SPACING_M = 120;

/** A label anchor in metres with the text rotation in radians. */
export type StreetLabel = { text: string; x: number; y: number; angle: number };

function polylineLength(points: DecodedRoad["points"]): number {
  let total = 0;
  for (let index = 0; index + 1 < points.length; index++) {
    total += Math.hypot(
      points[index + 1][0] - points[index][0],
      points[index + 1][1] - points[index][1],
    );
  }
  return total;
}

function pointAlong(
  points: DecodedRoad["points"],
  distance: number,
): { x: number; y: number; angle: number } {
  let remaining = distance;
  for (let index = 0; index + 1 < points.length; index++) {
    const [ax, ay] = points[index];
    const [bx, by] = points[index + 1];
    const segment = Math.hypot(bx - ax, by - ay);
    if (remaining <= segment || index === points.length - 2) {
      const t = segment === 0 ? 0 : Math.min(1, remaining / segment);
      let angle = Math.atan2(by - ay, bx - ax);
      if (angle > Math.PI / 2 || angle <= -Math.PI / 2)
        angle += angle > 0 ? -Math.PI : Math.PI;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle };
    }
    remaining -= segment;
  }
  return { x: points[0][0], y: points[0][1], angle: 0 };
}

/** Label anchors for a named road piece, only where the anchor lies inside the tile's own rect. */
export function planStreetLabels(
  road: DecodedRoad,
  ownRect: Rect,
): StreetLabel[] {
  if (!road.name || road.points.length < 2) return [];
  const length = polylineLength(road.points);
  if (length < LABEL_MIN_SEGMENT_M) return [];
  const count = Math.max(1, Math.floor(length / LABEL_SPACING_M));
  const labels: StreetLabel[] = [];
  for (let index = 1; index <= count; index++) {
    const anchor = pointAlong(road.points, (length * index) / (count + 1));
    const inside =
      anchor.x >= ownRect.minX &&
      anchor.x < ownRect.maxX &&
      anchor.y >= ownRect.minY &&
      anchor.y < ownRect.maxY;
    if (inside)
      labels.push({
        text: road.name,
        x: anchor.x,
        y: anchor.y,
        angle: anchor.angle,
      });
  }
  return labels;
}
