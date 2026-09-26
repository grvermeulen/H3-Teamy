/**
 * The city layer of the 3D view (spec §6.5): the shared world materials — the 2D map's surface art
 * loaded as repeating textures, and the generated façades — and the streamed cells built with
 * them. The cells are made by the first frame, which brings the world session's landmark lookup
 * for the landmark dressing, and made again only when a frame brings another session's lookup.
 */
import { Group, TextureLoader } from "three";
import type { DecodedTile } from "../world/decode";
import type { LandmarkStyles } from "./buildCell";
import type { FurnitureInstance } from "./furnitureMesh";
import { viewDistanceFor, type RenderQuality } from "./renderer3d";
import {
  createWorldCells,
  type StructureView,
  type WorldCells,
} from "./worldCells";
import {
  createWorldMaterials,
  disposeWorldMaterials,
  type WorldMaterials,
} from "./worldMaterials";

/** Milliseconds per frame the city may spend building cells (spec §6.5 allows 5). */
export const WORLD_BUILD_BUDGET_MS = 4;

/** What the city reads from a frame; `View3dFrame` fits. */
export type CityFrame = {
  scene: { world: { landmarks: LandmarkStyles } };
  tiles: readonly DecodedTile[];
  structures: readonly StructureView[];
  quality: RenderQuality;
  size: { width: number; height: number };
};

/** The streamed city with its materials. */
export type City3d = {
  /** Add to the scene once; it holds the cells. */
  object: Group;
  /**
   * Streams the city around `focus` out to the view distance of the frame's quality and width,
   * and drops the buildings that fell (the same frame the structure list says so).
   */
  update(focus: { x: number; y: number }, frame: CityFrame): void;
  /** The built cells' furniture near a point; see {@link WorldCells.furnitureNear}. */
  furnitureNear: WorldCells["furnitureNear"];
  /** Frees the cells and the shared materials. */
  dispose(): void;
};

/**
 * The city's shared materials, the surface art loaded with three's `TextureLoader`.
 *
 * @returns A fresh set; free it with `disposeWorldMaterials`.
 */
export function loadWorldMaterials(): WorldMaterials {
  const loader = new TextureLoader();
  return createWorldMaterials((url) => loader.load(url));
}

/** The streamed cells and the landmark lookup they were made with. */
type Streamed = { cells: WorldCells; landmarks: LandmarkStyles };

/** The cells for `landmarks`: the current ones, or new ones in their place. */
function streamedFor(
  parent: Group,
  current: Streamed | null,
  materials: WorldMaterials,
  landmarks: LandmarkStyles,
): Streamed {
  if (current?.landmarks === landmarks) return current;
  if (current) {
    parent.remove(current.cells.group);
    current.cells.dispose();
  }
  const cells = createWorldCells(materials, landmarks);
  parent.add(cells.group);
  return { cells, landmarks };
}

/**
 * Creates the city layer.
 *
 * @param materials - The shared materials; loaded from the served art by default. The city owns
 *   them and frees them on `dispose`.
 * @returns The city; call `update` every frame.
 */
export function createCity3d(
  materials: WorldMaterials = loadWorldMaterials(),
): City3d {
  const object = new Group();
  object.name = "city";
  let streamed: Streamed | null = null;
  return {
    object,
    update(focus, frame) {
      streamed = streamedFor(
        object,
        streamed,
        materials,
        frame.scene.world.landmarks,
      );
      streamed.cells.update(
        focus,
        frame.tiles,
        frame.structures,
        viewDistanceFor(frame.quality, frame.size.width),
        WORLD_BUILD_BUDGET_MS,
      );
    },
    furnitureNear(x, y, radius, into: FurnitureInstance[] = []) {
      if (!streamed) {
        into.length = 0;
        return into;
      }
      return streamed.cells.furnitureNear(x, y, radius, into);
    },
    dispose() {
      streamed?.cells.dispose();
      streamed = null;
      disposeWorldMaterials(materials);
    },
  };
}
