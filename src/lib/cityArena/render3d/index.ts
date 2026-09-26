/**
 * The 3D view's entry point, loaded only through a dynamic `import()` the first time a player
 * switches to 3D, so the 2D game's bundle never carries three.js (spec §6.1). Everything outside
 * `render3d/` and `components/cityArena/view3d/` may import from here with `import type` only.
 */
import type { Scene as ArenaScene } from "../render/renderScene";
import { lengthOf } from "../sim/vehicle";
import type { DecodedTile } from "../world/decode";
import { applyRigPose, rigPose, type CameraMode } from "./cameraRig";
import { drawOverlay3d } from "./overlay3d";
import {
  createPlaceholderEntities,
  createPlaceholderWorld,
  type PlaceholderEntities,
  type PlaceholderWorld,
} from "./placeholders";
import {
  createRenderer3d,
  viewDistanceFor,
  type RenderQuality,
  type Renderer3d,
} from "./renderer3d";

export type { CameraMode } from "./cameraRig";
export { pitchLimitsFor } from "./cameraRig";

/**
 * A building's damage as the 3D view reads it. Mirrors the simulation's `StructureState`
 * (Track S) until that lands on this branch; the runtime passes an empty list for now.
 */
export type StructureView = {
  id: number;
  damage: number;
  destroyedAtTick: number | null;
};

/** Everything the 3D view draws in one frame. */
export type View3dFrame = {
  /** The same blended scene the 2D renderer draws. */
  scene: ArenaScene;
  /** The loaded map tiles. */
  tiles: readonly DecodedTile[];
  /** Damaged and destroyed buildings. */
  structures: readonly StructureView[];
  /** Mouse-look yaw (world heading) and pitch, radians. */
  yaw: number;
  pitch: number;
  /**
   * The heading the simulation shoots along this frame: the yaw, or a camera-relative touch or
   * gamepad aim stick — the crosshair follows it.
   */
  aim: number;
  mode: CameraMode;
  /** Seconds since the previous frame. */
  dt: number;
  /** The frame clock, milliseconds. */
  nowMs: number;
  /** Seconds since the local player died, or `null` while alive. */
  deadSeconds: number | null;
  quality: RenderQuality;
  /** The canvas's CSS size. */
  size: { width: number; height: number };
};

/** A live 3D view. */
export type View3dHandle = {
  /** Renders a frame into the WebGL canvas and its HUD onto the cleared 2D canvas above. */
  render(frame: View3dFrame, overlay: CanvasRenderingContext2D): void;
  /** Frees every GPU resource and the WebGL context. */
  dispose(): void;
};

/** Milliseconds per frame the world layer may spend building new geometry. */
const WORLD_BUILD_BUDGET_MS = 4;

/** Who the camera follows: the local player, or the car they drive. */
export type Focus = {
  x: number;
  y: number;
  driving: { length: number; heading: number } | null;
};

/**
 * The camera's subject in a scene: the local player's blended pose, or their car's when driving.
 *
 * @param scene - The frame's scene.
 * @returns Its position and, in a car, the car's length and heading.
 */
export function focusOf(scene: ArenaScene): Focus {
  const player = scene.players.find(
    (candidate) => candidate.id === scene.localPlayerId,
  );
  if (!player) return { x: 0, y: 0, driving: null };
  const car =
    player.vehicleId === null
      ? undefined
      : scene.vehicles.find((vehicle) => vehicle.id === player.vehicleId);
  if (!car) return { x: player.x, y: player.y, driving: null };
  return {
    x: car.x,
    y: car.y,
    driving: { length: lengthOf(car.kind), heading: car.heading },
  };
}

/** The renderer and the two layers it draws. */
type View3dParts = {
  renderer: Renderer3d;
  world: PlaceholderWorld;
  entities: PlaceholderEntities;
};

/** Places the camera, syncs the layers, renders, then draws the HUD. */
function renderFrame(
  parts: View3dParts,
  frame: View3dFrame,
  overlay: CanvasRenderingContext2D,
): void {
  const focus = focusOf(frame.scene);
  const dead = frame.deadSeconds !== null;
  const { renderer, world, entities } = parts;
  renderer.configure(frame.size, frame.quality);
  applyRigPose(
    renderer.camera,
    rigPose({
      mode: frame.mode,
      yaw: frame.yaw,
      pitch: frame.pitch,
      target: focus,
      driving: focus.driving,
      dead,
      deadSeconds: frame.deadSeconds ?? 0,
      dt: frame.dt,
    }),
  );
  world.update(
    focus,
    frame.tiles,
    frame.structures,
    viewDistanceFor(frame.quality),
    WORLD_BUILD_BUDGET_MS,
  );
  entities.update(frame.scene, focus, {
    hideLocalPlayer: frame.mode === "first" && !dead,
  });
  renderer.render();
  drawOverlay3d(overlay, renderer.camera, {
    origin: focus,
    aim: frame.aim,
    size: frame.size,
    dead,
  });
}

/**
 * Starts the 3D view on `canvas` (spec §6): renderer, sky, lights and fog, with placeholder
 * city and cast until the real world cells, characters and vehicles are wired in.
 *
 * @param canvas - The WebGL canvas stacked under the 2D HUD canvas.
 * @returns The live view.
 * @throws {WebGl2UnavailableError} When WebGL2 is unavailable — the caller falls back to 2D.
 */
export function createView3d(canvas: HTMLCanvasElement): View3dHandle {
  const renderer = createRenderer3d(canvas);
  const parts: View3dParts = {
    renderer,
    world: createPlaceholderWorld(),
    entities: createPlaceholderEntities(),
  };
  renderer.scene.add(parts.world.group, parts.entities.group);
  return {
    render: (frame, overlay) => renderFrame(parts, frame, overlay),
    dispose() {
      parts.world.dispose();
      parts.entities.dispose();
      renderer.dispose();
    },
  };
}
