import {
  polygonCentroid,
  rectsIntersect,
  type Rect,
} from "../mapBuild/geometry";
import type { DecodedRoad, DecodedTile } from "../world/decode";
import type { LandmarkStyle } from "../world/mapTypes";
import type { Point } from "../world/projection";
import type { RasterContext } from "./canvasTypes";
import {
  BUILDING_STROKE,
  CENTRE_LINE_CLASSES,
  GROUND_FILL,
  LABEL_FILL,
  LABEL_HALO,
  LANDMARK_FILL,
  LANDMARK_LABEL_PX,
  PAVEMENT_CLASSES,
  PAVEMENT_FILL,
  PAVEMENT_WIDTH_M,
  ROAD_CENTRE_LINE,
  ROAD_FILL,
  ROAD_WIDTH_M,
  STREET_LABEL_PX,
  WATER_FILL,
  buildingFill,
} from "./palette";
import { planStreetLabels } from "./streetLabels";

/** Display name and style of a landmark, keyed by landmark key (built from `index.landmarks`). */
export type LandmarkInfo = { name: string; style: LandmarkStyle };
/** Landmark lookup passed to the painter. */
export type LandmarkLookup = Map<string, LandmarkInfo>;

/**
 * How far a tile's own rectangle is grown, in metres, before the tile counts as touching a
 * chunk — covers the geometry the tile asset stores just past its own 2 km edge.
 */
const TILE_OVERLAP_MARGIN_M = 20;
/** Building outline width, in metres. */
const BUILDING_STROKE_WIDTH_M = 0.3;
/** Dashed road centre-line width, in metres. */
const CENTRE_LINE_WIDTH_M = 0.3;
/** Dash pattern of the road centre line, in metres. */
const CENTRE_LINE_DASH_M: number[] = [3, 3];
/** Label halo (outline) stroke width, in screen pixels. */
const LABEL_HALO_WIDTH_PX = 3;
/** Extra stroke width added on each side of a road for its pavement. */
const PAVEMENT_SIDES = 2;

/** Traces a polyline or ring into the current path without filling or stroking it. */
function tracePath(
  context: RasterContext,
  points: Point[],
  close: boolean,
): void {
  context.beginPath();
  points.forEach(([x, y], index) =>
    index === 0 ? context.moveTo(x, y) : context.lineTo(x, y),
  );
  if (close) context.closePath();
}

/** Fills a closed ring with a flat colour. */
function fillRing(context: RasterContext, ring: Point[], fill: string): void {
  tracePath(context, ring, true);
  context.fillStyle = fill;
  context.fill();
}

/** Strokes an open polyline, optionally dashed. */
function strokePolyline(
  context: RasterContext,
  points: Point[],
  colour: string,
  widthMetres: number,
  dash: number[] = [],
): void {
  tracePath(context, points, false);
  context.strokeStyle = colour;
  context.lineWidth = widthMetres;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash(dash);
  context.stroke();
  context.setLineDash([]);
}

/** Paints ground polygons touching the chunk, across every touching tile. */
function paintGround(
  context: RasterContext,
  tiles: DecodedTile[],
  chunkRect: Rect,
): void {
  for (const tile of tiles)
    for (const area of tile.ground)
      if (rectsIntersect(area.bounds, chunkRect))
        fillRing(context, area.ring, GROUND_FILL[area.kind]);
}

/** Paints water polygons touching the chunk, across every touching tile. */
function paintWater(
  context: RasterContext,
  tiles: DecodedTile[],
  chunkRect: Rect,
): void {
  for (const tile of tiles)
    for (const area of tile.water)
      if (rectsIntersect(area.bounds, chunkRect))
        fillRing(context, area.ring, WATER_FILL);
}

/** Paints the pavement under roads whose class gets one. */
function paintPavements(context: RasterContext, roads: DecodedRoad[]): void {
  for (const road of roads) {
    if (PAVEMENT_CLASSES.includes(road.roadClass))
      strokePolyline(
        context,
        road.points,
        PAVEMENT_FILL,
        ROAD_WIDTH_M[road.roadClass] + PAVEMENT_SIDES * PAVEMENT_WIDTH_M,
      );
  }
}

/** Paints every road's surface. */
function paintRoadSurfaces(context: RasterContext, roads: DecodedRoad[]): void {
  for (const road of roads)
    strokePolyline(
      context,
      road.points,
      ROAD_FILL,
      ROAD_WIDTH_M[road.roadClass],
    );
}

/** Paints the dashed centre line on roads whose class gets one. */
function paintCentreLines(context: RasterContext, roads: DecodedRoad[]): void {
  for (const road of roads) {
    if (CENTRE_LINE_CLASSES.includes(road.roadClass))
      strokePolyline(
        context,
        road.points,
        ROAD_CENTRE_LINE,
        CENTRE_LINE_WIDTH_M,
        CENTRE_LINE_DASH_M,
      );
  }
}

/** Paints buildings touching the chunk, using a landmark's style fill when one applies. */
function paintBuildings(
  context: RasterContext,
  tile: DecodedTile,
  chunkRect: Rect,
  landmarks: LandmarkLookup,
): void {
  for (const building of tile.buildings) {
    if (!rectsIntersect(building.bounds, chunkRect)) continue;
    const style = building.landmark
      ? landmarks.get(building.landmark)?.style
      : undefined;
    fillRing(
      context,
      building.ring,
      style ? LANDMARK_FILL[style] : buildingFill(building.levels),
    );
    context.strokeStyle = BUILDING_STROKE;
    context.lineWidth = BUILDING_STROKE_WIDTH_M;
    context.setLineDash([]);
    context.stroke();
  }
}

/** Paints one line of haloed text centred at `(x, y)`, rotated by `angle` radians. */
function paintText(
  context: RasterContext,
  text: string,
  x: number,
  y: number,
  angle: number,
  sizePx: number,
  zoom: number,
): void {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.font = `${sizePx / zoom}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.strokeStyle = LABEL_HALO;
  context.lineWidth = LABEL_HALO_WIDTH_PX / zoom;
  context.strokeText(text, 0, 0);
  context.fillStyle = LABEL_FILL;
  context.fillText(text, 0, 0);
  context.restore();
}

/** True when `(x, y)` lies inside `rect` (min inclusive, max exclusive). */
function insideRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.minX && x < rect.maxX && y >= rect.minY && y < rect.maxY;
}

/** Paints street name and landmark labels whose anchor falls inside the chunk. */
function paintLabels(
  context: RasterContext,
  tile: DecodedTile,
  chunkRect: Rect,
  zoom: number,
  landmarks: LandmarkLookup,
): void {
  for (const road of tile.roads) {
    for (const label of planStreetLabels(road, tile.rect)) {
      if (insideRect(label.x, label.y, chunkRect))
        paintText(
          context,
          label.text,
          label.x,
          label.y,
          label.angle,
          STREET_LABEL_PX,
          zoom,
        );
    }
  }
  for (const building of tile.buildings) {
    const info = building.landmark
      ? landmarks.get(building.landmark)
      : undefined;
    if (!info || !rectsIntersect(building.bounds, chunkRect)) continue;
    const [x, y] = polygonCentroid(building.ring);
    if (insideRect(x, y, tile.rect) && insideRect(x, y, chunkRect))
      paintText(context, info.name, x, y, 0, LANDMARK_LABEL_PX, zoom);
  }
}

/** Tiles whose rectangle, grown by {@link TILE_OVERLAP_MARGIN_M}, intersects `chunkRect`. */
function tilesTouching(tiles: DecodedTile[], chunkRect: Rect): DecodedTile[] {
  return tiles.filter((tile) =>
    rectsIntersect(
      {
        minX: tile.rect.minX - TILE_OVERLAP_MARGIN_M,
        minY: tile.rect.minY - TILE_OVERLAP_MARGIN_M,
        maxX: tile.rect.maxX + TILE_OVERLAP_MARGIN_M,
        maxY: tile.rect.maxY + TILE_OVERLAP_MARGIN_M,
      },
      chunkRect,
    ),
  );
}

/**
 * Paints everything static inside `chunkRect` at `zoom` px/m into a context that maps metres to
 * pixels. Each layer runs once over every touching tile's geometry (ground, then water, then
 * pavements, road surfaces and centre lines, then buildings, then labels) rather than painting
 * every layer of one tile before moving to the next — `tilesTouching` pulls in neighbouring
 * tiles' overlap geometry, and painting per tile let a later tile's ground or road fill
 * overwrite an earlier tile's water or centre line right at the shared border.
 */
export function paintChunk(
  context: RasterContext,
  chunkRect: Rect,
  zoom: number,
  tiles: DecodedTile[],
  landmarks: LandmarkLookup,
): void {
  context.setTransform(
    zoom,
    0,
    0,
    zoom,
    -chunkRect.minX * zoom,
    -chunkRect.minY * zoom,
  );
  context.fillStyle = GROUND_FILL.urban;
  context.fillRect(
    chunkRect.minX,
    chunkRect.minY,
    chunkRect.maxX - chunkRect.minX,
    chunkRect.maxY - chunkRect.minY,
  );
  const touching = tilesTouching(tiles, chunkRect);
  paintGround(context, touching, chunkRect);
  paintWater(context, touching, chunkRect);
  const roads = touching.flatMap((tile) =>
    tile.roads.filter((road) => rectsIntersect(road.bounds, chunkRect)),
  );
  paintPavements(context, roads);
  paintRoadSurfaces(context, roads);
  paintCentreLines(context, roads);
  for (const tile of touching)
    paintBuildings(context, tile, chunkRect, landmarks);
  for (const tile of touching)
    paintLabels(context, tile, chunkRect, zoom, landmarks);
}
