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

/** How far a canopy's shadow falls to the south-east, metres. */
const CANOPY_SHADOW_OFFSET_M = 1.2;
/** Radius of the flat disc that stands in for a lamp without art, metres. */
const LAMP_DISC_M = 0.3;
/** Furniture this far outside a chunk still paints into it: half the longest piece. */
const FURNITURE_MARGIN_M = 2;
/** Two irrationals that turn a tree's position into a turn of its canopy, so a wood does not tile. */
const CANOPY_TURN_X = 12.9898;
const CANOPY_TURN_Y = 78.233;

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
 * Paints the trees touching the chunk: every shadow first, then every canopy, so no canopy is
 * darkened by its neighbour's shadow.
 *
 * @param context - The chunk's context, in world metres.
 * @param tiles - The tiles touching the chunk.
 * @param chunkRect - The chunk's rectangle, metres.
 * @param props - The loaded prop art, if any.
 */
export function paintTrees(
  context: RasterContext,
  tiles: DecodedTile[],
  chunkRect: Rect,
  props: PropSprites | undefined,
): void {
  const trees = tiles.flatMap((tile) =>
    tile.trees.filter((tree) => rectsIntersect(tree.bounds, chunkRect)),
  );
  for (const tree of trees)
    fillDisc(
      context,
      tree.point[0] + CANOPY_SHADOW_OFFSET_M,
      tree.point[1] + CANOPY_SHADOW_OFFSET_M,
      TREE_CANOPY_M[tree.size] / 2,
      TREE_SHADOW,
    );
  for (const tree of trees)
    paintCanopy(context, tree, props?.[TREE_PROP_KEYS[tree.size]]);
}

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
