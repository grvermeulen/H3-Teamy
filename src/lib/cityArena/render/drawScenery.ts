import { rectsIntersect, type Rect } from "../mapBuild/geometry";
import type {
  DecodedFurniture,
  DecodedTile,
  DecodedTree,
} from "../world/decode";
import { FURNITURE_SIZE_M, TREE_CANOPY_M } from "../world/mapTypes";
import type { RasterContext } from "./canvasTypes";
import { FURNITURE_FILL, TREE_CANOPY_FILL, TREE_SHADOW } from "./palette";
import { TREE_PROP_KEYS, type PropSprite, type PropSprites } from "./sprites";
import type { ChunkLayer } from "./staticRaster";

/** How far a canopy's shadow falls to the south-east, metres. */
const CANOPY_SHADOW_OFFSET_M = 1.2;
/** Radius of the flat disc that stands in for a lamp without art, metres. */
const LAMP_DISC_M = 0.3;
/** Furniture this far outside a chunk still paints into it: half the longest piece. */
const FURNITURE_MARGIN_M = 2;
/** Two irrationals that turn a tree's position into a turn of its canopy, so a wood does not tile. */
const CANOPY_TURN_X = 12.9898;
const CANOPY_TURN_Y = 78.233;
/**
 * Pixels per metre of the canopy layer relative to the ground's: foliage survives being drawn
 * at half the resolution and scaled up, and the layer costs a quarter of the ground's canvas.
 */
export const CANOPY_RESOLUTION = 0.5;

/** The turn a tree's canopy art gets, radians, from where it stands. */
function canopyTurn(tree: DecodedTree): number {
  return (
    (tree.point[0] * CANOPY_TURN_X + tree.point[1] * CANOPY_TURN_Y) %
    (2 * Math.PI)
  );
}

/** A filled disc. */
function fillDisc(
  context: RasterContext,
  x: number,
  y: number,
  radius: number,
  fill: string,
): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
}

/** One canopy: the art turned to its own angle, or a flat disc without it. */
function paintCanopy(
  context: RasterContext,
  tree: DecodedTree,
  sprite: PropSprite | undefined,
): void {
  const [x, y] = tree.point;
  const diameter = TREE_CANOPY_M[tree.size];
  if (!sprite) {
    fillDisc(context, x, y, diameter / 2, TREE_CANOPY_FILL[tree.size]);
    return;
  }
  context.save();
  context.translate(x, y);
  context.rotate(canopyTurn(tree));
  context.drawImage(
    sprite.image,
    -diameter / 2,
    -diameter / 2,
    diameter,
    diameter,
  );
  context.restore();
}

/**
 * Paints the shadows of the trees touching the chunk into the ground layer. The canopies
 * themselves go to the overhead layer ({@link CANOPY_LAYER}), drawn over the cars and the
 * people, so whoever walks under a tree is under it.
 *
 * @param context - The chunk's context, in world metres.
 * @param tiles - The tiles touching the chunk.
 * @param chunkRect - The chunk's rectangle, metres.
 */
export function paintTreeShadows(
  context: RasterContext,
  tiles: DecodedTile[],
  chunkRect: Rect,
): void {
  // A canopy just past the chunk's north-west edge still throws its shadow into the chunk.
  const reach: Rect = {
    minX: chunkRect.minX - CANOPY_SHADOW_OFFSET_M,
    minY: chunkRect.minY - CANOPY_SHADOW_OFFSET_M,
    maxX: chunkRect.maxX,
    maxY: chunkRect.maxY,
  };
  for (const tile of tiles)
    for (const tree of tile.trees) {
      if (!rectsIntersect(tree.bounds, reach)) continue;
      fillDisc(
        context,
        tree.point[0] + CANOPY_SHADOW_OFFSET_M,
        tree.point[1] + CANOPY_SHADOW_OFFSET_M,
        TREE_CANOPY_M[tree.size] / 2,
        TREE_SHADOW,
      );
    }
}

/**
 * Paints the canopies of the trees touching the chunk: the art turned by each tree's own angle,
 * or a flat disc without it.
 *
 * @param context - The chunk's context, in world metres.
 * @param tiles - The tiles the trees may come from.
 * @param chunkRect - The chunk's rectangle, metres.
 * @param props - The loaded prop art, if any.
 */
export function paintCanopies(
  context: RasterContext,
  tiles: DecodedTile[],
  chunkRect: Rect,
  props: PropSprites | undefined,
): void {
  for (const tile of tiles)
    for (const tree of tile.trees)
      if (rectsIntersect(tree.bounds, chunkRect))
        paintCanopy(context, tree, props?.[TREE_PROP_KEYS[tree.size]]);
}

/** True when a canopy reaches into the rectangle. */
function hasCanopy(rect: Rect, tiles: DecodedTile[]): boolean {
  return tiles.some((tile) =>
    tile.trees.some((tree) => rectsIntersect(tree.bounds, rect)),
  );
}

/**
 * The overhead raster layer: the canopies alone, over a transparent chunk, drawn after the
 * moving things so a player walking under a tree disappears beneath it. A chunk without a tree
 * gets no canvas at all.
 */
export const CANOPY_LAYER: ChunkLayer = {
  resolution: CANOPY_RESOLUTION,
  covers: hasCanopy,
  paint: (context, rect, zoom, tiles, _landmarks, sprites) => {
    context.setTransform(
      zoom,
      0,
      0,
      zoom,
      -rect.minX * zoom,
      -rect.minY * zoom,
    );
    paintCanopies(context, tiles, rect, sprites.props);
  },
};

/** One piece of furniture, turned to its heading: the art, or a flat shape without it. */
function paintPiece(
  context: RasterContext,
  piece: DecodedFurniture,
  sprite: PropSprite | undefined,
): void {
  const [length, width] = FURNITURE_SIZE_M[piece.kind];
  context.save();
  context.translate(piece.point[0], piece.point[1]);
  context.rotate(piece.heading);
  if (sprite)
    context.drawImage(sprite.image, -length / 2, -width / 2, length, width);
  else if (piece.kind === "lamp")
    fillDisc(context, 0, 0, LAMP_DISC_M, FURNITURE_FILL.lamp);
  else {
    context.fillStyle = FURNITURE_FILL[piece.kind];
    context.fillRect(-length / 2, -width / 2, length, width);
  }
  context.restore();
}

/**
 * Paints the street furniture standing in or just outside the chunk, in the order the tiles hold
 * it.
 *
 * @param context - The chunk's context, in world metres.
 * @param tiles - The tiles touching the chunk.
 * @param chunkRect - The chunk's rectangle, metres.
 * @param props - The loaded prop art, if any.
 */
export function paintFurniture(
  context: RasterContext,
  tiles: DecodedTile[],
  chunkRect: Rect,
  props: PropSprites | undefined,
): void {
  const reach: Rect = {
    minX: chunkRect.minX - FURNITURE_MARGIN_M,
    minY: chunkRect.minY - FURNITURE_MARGIN_M,
    maxX: chunkRect.maxX + FURNITURE_MARGIN_M,
    maxY: chunkRect.maxY + FURNITURE_MARGIN_M,
  };
  for (const tile of tiles)
    for (const piece of tile.furniture) {
      const [x, y] = piece.point;
      if (x < reach.minX || x > reach.maxX || y < reach.minY || y > reach.maxY)
        continue;
      paintPiece(context, piece, props?.[piece.kind]);
    }
}
