/**
 * Items drawn with canvas paths until their art exists (spec §5): the rocket launcher, on the
 * ground and in a hand. Art in the sprite manifest always wins; a stand-in only fills the gap.
 */
import type { RasterContext } from "./canvasTypes";
import { ROCKET_TIP, ROCKET_TUBE } from "./palette";
import type { ItemKey, ItemSprites, PropSprite } from "./sprites";

/**
 * An item painted with paths: its real size, and a painter that fills a `length` × `width` box
 * whose top-left corner is (`left`, `top`), laid along +x with the item's front end at +x — the
 * same box an item's image is drawn into.
 */
export type VectorItem = {
  lengthMetres: number;
  widthMetres: number;
  paint(
    context: RasterContext,
    left: number,
    top: number,
    length: number,
    width: number,
  ): void;
};

/** What an item is drawn with: its sprite once it has loaded, else its vector stand-in. */
export type ItemArt = PropSprite | VectorItem;

/** Share of the launcher's length that is the rocket's warhead showing past the muzzle. */
const ROCKET_TIP_SHARE = 0.2;

/** Paints the launcher: an olive tube, and the red cone of the rocket at its front end. */
function paintRocketLauncher(
  context: RasterContext,
  left: number,
  top: number,
  length: number,
  width: number,
): void {
  const muzzle = left + length * (1 - ROCKET_TIP_SHARE);
  context.beginPath();
  context.rect(left, top, muzzle - left, width);
  context.fillStyle = ROCKET_TUBE;
  context.fill();
  context.beginPath();
  context.moveTo(muzzle, top);
  context.lineTo(left + length, top + width / 2);
  context.lineTo(muzzle, top + width);
  context.closePath();
  context.fillStyle = ROCKET_TIP;
  context.fill();
}

/** The rocket launcher (Raketwerper) until it has art: a shoulder tube 1.1 m long. */
export const ROCKET_LAUNCHER_ITEM: VectorItem = {
  lengthMetres: 1.1,
  widthMetres: 0.16,
  paint: paintRocketLauncher,
};

/** The stand-ins by item key; an item with art of its own has none. */
const VECTOR_ITEMS: Partial<Record<ItemKey, VectorItem>> = {
  rocket: ROCKET_LAUNCHER_ITEM,
};

/**
 * The art to draw an item with: its loaded sprite, else its vector stand-in.
 *
 * @param items - The loaded items, or `undefined` before any art has loaded.
 * @param key - The item, or null for an empty hand.
 * @returns The art, or `undefined` when there is nothing to draw yet.
 */
export function itemArtFor(
  items: ItemSprites | undefined,
  key: ItemKey | null,
): ItemArt | undefined {
  if (key === null) return undefined;
  return items?.[key] ?? VECTOR_ITEMS[key];
}

/**
 * Draws an item into a box laid along +x: the image for a sprite, the paths for a stand-in.
 *
 * @param context - The canvas, already turned so the item's front points along +x.
 * @param art - The item's art.
 * @param left - Left edge of the box.
 * @param top - Top edge of the box.
 * @param length - Box length along +x.
 * @param width - Box width.
 */
export function paintItem(
  context: RasterContext,
  art: ItemArt,
  left: number,
  top: number,
  length: number,
  width: number,
): void {
  if ("image" in art) context.drawImage(art.image, left, top, length, width);
  else art.paint(context, left, top, length, width);
}
