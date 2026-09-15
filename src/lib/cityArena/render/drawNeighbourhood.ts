import { cellNoise } from "../mapBuild/vegetation";
import { rectsIntersect, type Rect } from "../mapBuild/geometry";
import type { DecodedBuilding, DecodedTile } from "../world/decode";
import type { RasterContext } from "./canvasTypes";
import { orientedBox } from "./drawLandmarks";
import { roofKindOf } from "./drawRoofs";

const ROOF_TINTS = [
  "#af603d",
  "#647788",
  "#8d654f",
  "#536d58",
  "#977d66",
  "#414d65",
];

/** Garden strips and paved aprons beneath the road layer, so streets stay unobstructed. */
export function paintHouseGardens(
  context: RasterContext,
  tiles: DecodedTile[],
  chunk: Rect,
): void {
  for (const tile of tiles)
    for (const building of tile.buildings) {
      if (
        building.landmark ||
        roofKindOf(building) !== "tiles" ||
        !rectsIntersect(
          {
            minX: building.bounds.minX - 4,
            minY: building.bounds.minY - 4,
            maxX: building.bounds.maxX + 4,
            maxY: building.bounds.maxY + 4,
          },
          chunk,
        )
      )
        continue;
      const box = orientedBox(building.ring);
      if (box.width < 4 || box.length > 28) continue;
      const variant = buildingVariant(building);
      const l = box.length,
        w = box.width;
      context.save();
      context.translate(box.centre[0], box.centre[1]);
      context.rotate(box.angle);
      context.fillStyle = variant % 3 === 0 ? "#6c6f5c" : "#4a6043";
      context.fillRect(-l / 2 - 1, -w / 2 - 3, l + 2, w + 5);
      context.fillStyle = "#8b8979";
      context.fillRect(-l / 2 - 0.6, w / 2, l + 1.2, 1.7);
      context.fillStyle = "#354c36";
      context.fillRect(-l / 2 - 1, -w / 2 - 3, l + 2, 0.6);
      for (let x = -l / 2; x < l / 2; x += 2.3) {
        context.fillStyle = "#79905b";
        context.fillRect(x, -w / 2 - 2.8, 1.5, 0.35);
        if (variant % 2 === 0) {
          context.fillStyle = "#5d4838";
          context.fillRect(x, w / 2 + 0.8, 1.1, 0.45);
          context.fillStyle = variant === 0 ? "#d79691" : "#d9c47c";
          context.fillRect(x + 0.15, w / 2 + 0.75, 0.2, 0.3);
          context.fillRect(x + 0.65, w / 2 + 0.75, 0.2, 0.3);
        }
      }
      context.restore();
    }
}

/** Stable building variation, unaffected by camera, load order or chunk boundaries. */
export function buildingVariant(
  building: Pick<DecodedBuilding, "bounds">,
): number {
  return Math.floor(
    cellNoise(
      Math.round(building.bounds.minX * 4),
      Math.round(building.bounds.minY * 4),
      71,
    ) * ROOF_TINTS.length,
  );
}

/** Roof materials, ridges, dormers, chimneys, solar panels and planted flat roofs. */
export function paintNeighbourhoodRoof(
  context: RasterContext,
  building: DecodedBuilding,
): void {
  if (building.landmark) return;
  const variant = buildingVariant(building);
  const box = orientedBox(building.ring);
  if (box.length < 3 || box.width < 3) return;
  context.save();
  context.beginPath();
  building.ring.forEach(([x, y], i) =>
    i ? context.lineTo(x, y) : context.moveTo(x, y),
  );
  context.closePath();
  context.clip();
  context.translate(box.centre[0], box.centre[1]);
  context.rotate(box.angle);
  const l = box.length,
    w = box.width;
  context.globalAlpha = 0.4;
  context.fillStyle = ROOF_TINTS[variant];
  context.fillRect(-l / 2, -w / 2, l, w);
  context.globalAlpha = 1;
  const roof = roofKindOf(building);
  if (roof === "tiles") paintTiledDetails(context, l, w, variant);
  else paintFlatDetails(context, l, w, variant);
  if (variant === 1 || variant === 4 || (roof === "flat" && variant !== 3))
    paintSolarPanels(context, l, w);
  context.restore();
}

/** Small ground details clipped to vegetation polygons, painted before water and roads. */
export function paintMeadowDetails(
  context: RasterContext,
  tiles: DecodedTile[],
  chunk: Rect,
): void {
  for (const tile of tiles)
    for (const area of tile.ground) {
      if (area.kind === "urban" || !rectsIntersect(area.bounds, chunk))
        continue;
      context.save();
      context.beginPath();
      area.ring.forEach(([x, y], i) =>
        i ? context.lineTo(x, y) : context.moveTo(x, y),
      );
      context.closePath();
      context.clip();
      const spacing = area.kind === "field" ? 9 : 12;
      for (
        let gx = Math.floor(
          Math.max(chunk.minX - 2, area.bounds.minX) / spacing,
        );
        gx <= Math.ceil(Math.min(chunk.maxX + 2, area.bounds.maxX) / spacing);
        gx++
      ) {
        for (
          let gy = Math.floor(
            Math.max(chunk.minY - 2, area.bounds.minY) / spacing,
          );
          gy <= Math.ceil(Math.min(chunk.maxY + 2, area.bounds.maxY) / spacing);
          gy++
        ) {
          paintGroundCell(context, area.kind, gx, gy, spacing);
        }
      }
      context.restore();
    }
}

/** Pitched-roof details in the building's local coordinates. */
function paintTiledDetails(
  context: RasterContext,
  l: number,
  w: number,
  variant: number,
): void {
  context.fillStyle = "rgba(5,17,25,0.3)";
  context.fillRect(-l / 2, 0, l, w / 2);
  context.fillStyle = "#c8a486";
  context.fillRect(-l / 2, -0.12, l, 0.24);
  for (let x = -l / 2 + 1; x < l / 2 - 1; x += 0.7) {
    context.fillStyle = "rgba(23,29,37,0.22)";
    context.fillRect(x, -w / 2, 0.08, w);
  }
  if (variant % 2 === 0 && w > 5) {
    for (let x = -l / 2 + 2; x < l / 2 - 1.5; x += 4) {
      context.fillStyle = "#bca992";
      context.fillRect(x, w * 0.17, 1.7, 1.5);
      context.fillStyle = "#486e81";
      context.fillRect(x + 0.2, w * 0.17 + 0.3, 1.3, 0.8);
      context.fillStyle = "#c9d9ce";
      context.fillRect(x + 0.8, w * 0.17 + 0.3, 0.12, 0.8);
    }
  }
  context.fillStyle = "#342c2a";
  context.fillRect(l * 0.23, -w * 0.25, 1, 1.2);
  context.fillStyle = "#bd8b6b";
  context.fillRect(l * 0.23 - 0.15, -w * 0.25 - 0.2, 1, 1);
  context.fillStyle = "#382f2c";
  context.fillRect(l * 0.23 + 0.05, -w * 0.25, 0.5, 0.5);
}

/** Flat-roof planting and ventilation units. */
function paintFlatDetails(
  context: RasterContext,
  l: number,
  w: number,
  variant: number,
): void {
  context.fillStyle = variant === 3 ? "#627b52" : "#8a8980";
  context.fillRect(-l * 0.35, -w * 0.3, l * 0.7, w * 0.6);
  context.fillStyle = "#555b5c";
  context.fillRect(l * 0.2, w * 0.15, 2, 1.4);
  context.fillStyle = "#b0b5ae";
  context.fillRect(l * 0.2, w * 0.15, 2, 0.25);
}

/** A bounded row of solar panels sized to the roof. */
function paintSolarPanels(context: RasterContext, l: number, w: number): void {
  for (let col = 0; col < Math.min(5, Math.floor(l / 3)); col++) {
    context.fillStyle = "#243f54";
    const x = -l * 0.35 + col * 2;
    context.fillRect(x, -w * 0.3, 1.7, 1.6);
    context.fillStyle = "#749eae";
    context.fillRect(x, -w * 0.3, 1.7, 0.12);
    context.fillRect(x + 0.8, -w * 0.3, 0.06, 1.6);
  }
}

/** One deterministic field or meadow cell, clipped by its caller. */
function paintGroundCell(
  context: RasterContext,
  kind: DecodedTile["ground"][number]["kind"],
  gx: number,
  gy: number,
  spacing: number,
): void {
  const noise = cellNoise(gx, gy, 83);
  const x = gx * spacing + cellNoise(gx, gy, 84) * 5;
  const y = gy * spacing + cellNoise(gx, gy, 85) * 5;
  if (kind === "field") {
    context.fillStyle = noise > 0.5 ? "#918450" : "#687443";
    for (let i = 0; i < 4; i++)
      context.fillRect(gx * spacing + i * 2, gy * spacing, 0.18, spacing);
  } else {
    context.fillStyle = noise > 0.5 ? "#527455" : "#75815b";
    context.fillRect(x, y, 0.16, 1.2);
    context.fillRect(x + 0.5, y + 0.3, 0.16, 0.8);
    context.fillRect(x - 0.4, y + 0.4, 0.16, 0.6);
    if (noise > 0.68) {
      context.fillStyle = noise > 0.9 ? "#c592b0" : "#d9c780";
      context.fillRect(x - 0.2, y, 0.4, 0.3);
      context.fillRect(x + 0.4, y + 0.3, 0.35, 0.3);
    } else if (noise < 0.15) {
      context.fillStyle = "#8e9383";
      context.fillRect(x, y, 0.8, 0.5);
      context.fillStyle = "#b2b7a0";
      context.fillRect(x, y, 0.6, 0.15);
    }
  }
}
