/**
 * Friends in 3D (spec §6.6): a small diamond floating over every other living player, in the
 * colour of their vest, always facing the camera and drawn over walls and fog, so a friend across
 * the block is found at a glance. It grows with distance, so it stays readable far away.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Camera,
} from "three";
import type { Scene } from "../render/renderScene";
import { vestColour } from "./characterLooks";
import { vestHueOf } from "./entityMotion";
import { createEntityPool } from "./entityPool";

/** Height of a marker over a player's feet, metres. */
export const MARKER_HEIGHT_M = 2.6;
/** Other players are marked within this distance of the camera focus, metres. */
export const MARKER_RANGE_M = 300;
/** Up to this far from the camera a marker keeps its size; beyond, it grows with the distance. */
export const MARKER_FULL_SIZE_M = 25;
/** Width and height of the diamond, metres. */
const MARKER_WIDTH_M = 0.42;
const MARKER_TALL_M = 0.62;
/** A marker is drawn after everything else, over it. */
const MARKER_RENDER_ORDER = 10;
/** Radix and digits of a CSS hex colour. */
const HEX_RADIX = 16;
const CSS_HEX_DIGITS = 6;

/** What the markers read from a frame's scene. */
export type PlayerMarkerScene = Pick<Scene, "players" | "localPlayerId">;

/** The live markers. */
export type PlayerMarkers3d = {
  /** Add to the scene once. */
  object: Group;
  /**
   * Floats a diamond over every other living player within {@link MARKER_RANGE_M} of the focus,
   * facing the camera, and frees the diamonds of players gone.
   */
  update(
    scene: PlayerMarkerScene,
    focus: { x: number; y: number },
    camera: Camera,
  ): void;
  /** Frees the diamond shape and every diamond's material. */
  dispose(): void;
};

/**
 * A player's marker colour: their vest's.
 *
 * @param playerId - The player.
 * @returns The colour as a hex number.
 */
export function markerColour(playerId: number): number {
  return vestColour(vestHueOf(playerId));
}

/** Each player's marker colour as CSS, made once per player. */
const cssColours = new Map<number, string>();

/**
 * A player's marker colour as CSS, for the arrows on the 2D overlay.
 *
 * @param playerId - The player.
 * @returns `#rrggbb`.
 */
export function markerCss(playerId: number): string {
  const known = cssColours.get(playerId);
  if (known) return known;
  const css = `#${markerColour(playerId).toString(HEX_RADIX).padStart(CSS_HEX_DIGITS, "0")}`;
  cssColours.set(playerId, css);
  return css;
}

/**
 * How much a marker is enlarged at a distance from the camera: not at all up to
 * {@link MARKER_FULL_SIZE_M}, then in step with the distance, so it keeps its size on screen.
 *
 * @param distance - Metres from the camera.
 * @returns A scale of 1 or more.
 */
export function markerScale(distance: number): number {
  return Math.max(1, distance / MARKER_FULL_SIZE_M);
}

/** The diamond, in its own plane facing +Z, centred on its origin. */
function createDiamondGeometry(): BufferGeometry {
  const halfWide = MARKER_WIDTH_M / 2;
  const halfTall = MARKER_TALL_M / 2;
  const geometry = new BufferGeometry();
  const corners = [
    0,
    halfTall,
    0,
    -halfWide,
    0,
    0,
    0,
    -halfTall,
    0,
    halfWide,
    0,
    0,
  ];
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(corners), 3),
  );
  geometry.setIndex([0, 1, 3, 1, 2, 3]);
  return geometry;
}

/** One player's diamond in their colour, over walls and fog. */
function createMarker(
  geometry: BufferGeometry,
  playerId: number,
): { object: Mesh; dispose(): void } {
  const material = new MeshBasicMaterial({
    color: markerColour(playerId),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "playerMarker";
  mesh.renderOrder = MARKER_RENDER_ORDER;
  return { object: mesh, dispose: () => material.dispose() };
}

/** True when `(x, y)` lies within the markers' range of the focus. */
function inRange(
  focus: { x: number; y: number },
  x: number,
  y: number,
): boolean {
  const dx = x - focus.x;
  const dy = y - focus.y;
  return dx * dx + dy * dy <= MARKER_RANGE_M * MARKER_RANGE_M;
}

/**
 * Creates the player markers.
 *
 * @returns The markers; call `update` every frame after the camera is placed.
 */
export function createPlayerMarkers3d(): PlayerMarkers3d {
  const object = new Group();
  object.name = "playerMarkers";
  const geometry = createDiamondGeometry();
  // A marker's colour is its player's alone, so a freed one is never reused (a one-off).
  const pool = createEntityPool<{ object: Mesh; dispose(): void }, null>(
    object,
    0,
  );
  return {
    object,
    update(scene, focus, camera) {
      pool.begin();
      for (const player of scene.players) {
        if (player.id === scene.localPlayerId || player.diedAtTick !== null)
          continue;
        if (!inRange(focus, player.x, player.y)) continue;
        const slot =
          pool.keep(player.id) ??
          pool.claim(
            player.id,
            null,
            () => createMarker(geometry, player.id),
            null,
          );
        const marker = slot.item.object;
        marker.position.set(player.x, MARKER_HEIGHT_M, player.y);
        marker.quaternion.copy(camera.quaternion);
        marker.scale.setScalar(
          markerScale(marker.position.distanceTo(camera.position)),
        );
      }
      pool.end();
    },
    dispose() {
      pool.dispose();
      geometry.dispose();
    },
  };
}
