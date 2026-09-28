/**
 * The 3D view's entry point, loaded only through a dynamic `import()` the first time a player
 * switches to 3D, so the 2D game's bundle never carries three.js (spec §6.1). Everything outside
 * `render3d/` and `components/cityArena/view3d/` may import from here with `import type` only.
 */
import type { Scene as ArenaScene } from "../render/renderScene";
import type { VehicleKind } from "../sim/types";
import { lengthOf } from "../sim/vehicle";
import type { DecodedTile } from "../world/decode";
import type { AimPoint } from "./aimProbe";
import { applyCameraFeel, cameraFeelOf } from "./cameraFeel";
import { applyRigPose, rigPose, type CameraMode } from "./cameraRig";
import { createCast3d, type Cast3d } from "./cast3d";
import { createCity3d, type City3d } from "./city3d";
import {
  createFrameAim,
  localWeapon,
  probeFrame,
  raiseSights,
  scopeOf,
  type FrameAim,
} from "./frameAim";
import { createGuidance3d, type Guidance3d } from "./guidance3d";
import { createKnockOvers, type KnockOvers } from "./knockOver3d";
import { createMissionMarkers, type MissionMarkers } from "./missionMarkers";
import { drawOverlay3d } from "./overlay3d";
import {
  createRenderer3d,
  type RenderQuality,
  type Renderer3d,
} from "./renderer3d";
import { createRuins3d, type Ruins3d } from "./ruins3d";
import { disposeSharedAssets } from "./sharedAssets";
import type { StructureView } from "./worldCells";

export type { AimPoint, AimTarget } from "./aimProbe";
export type { CameraMode } from "./cameraRig";
export { pitchLimitsFor } from "./cameraRig";
export type { StructureView } from "./worldCells";

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
   * The heading the simulation shoots along this frame: toward what the crosshair covered, or a
   * camera-relative touch or gamepad aim stick.
   */
  aim: number;
  mode: CameraMode;
  /** Seconds since the previous frame. */
  dt: number;
  /** The frame clock, milliseconds. */
  nowMs: number;
  /** Seconds since the local player died, or `null` while alive. */
  deadSeconds: number | null;
  /**
   * Aiming down the sights (the held right mouse button, or the touch sights toggle): the view
   * zooms and the hands bring the gun up. Absent, at the hip.
   */
  ads?: boolean;
  quality: RenderQuality;
  /** The canvas's CSS size. */
  size: { width: number; height: number };
};

/** A live 3D view. */
export type View3dHandle = {
  /** Renders a frame into the WebGL canvas and its HUD onto the cleared 2D canvas above. */
  render(frame: View3dFrame, overlay: CanvasRenderingContext2D): void;
  /**
   * What the crosshair covered in the last frame (aim spec §5): the runtime aims the simulation
   * at it. `null` before the first frame and while dead.
   */
  aimPoint(): Readonly<AimPoint> | null;
  /**
   * How much the sights narrowed the last frame's view (`RigPose.zoom`): mouse-look turns slower
   * by it, so a zoomed view does not whip. 1 at the hip.
   */
  lookZoom(): number;
  /** Frees every GPU resource and the WebGL context. */
  dispose(): void;
};

/** Who the camera follows: the local player, or the car they drive. */
export type Focus = {
  x: number;
  y: number;
  driving: { length: number; heading: number; kind: VehicleKind } | null;
};

/**
 * The camera's subject in a scene: the local player's blended pose, or their car's when driving.
 *
 * @param scene - The frame's scene.
 * @returns Its position and, in a car, the car's length, heading and kind (which seats the
 *   first-person driver).
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
    driving: {
      length: lengthOf(car.kind),
      heading: car.heading,
      kind: car.kind,
    },
  };
}

/**
 * The renderer, the layers it draws — the city, everything that moves in it, and the guidance
 * (route, beacons, zone wall, friends' markers) — the mission markers the cast and the guidance
 * share, and what turns the frame's structures and traffic into destruction: ruins and
 * knocked-over furniture.
 */
type View3dParts = {
  renderer: Renderer3d;
  city: City3d;
  cast: Cast3d;
  guidance: Guidance3d;
  markers: MissionMarkers;
  ruins: Ruins3d;
  knocks: KnockOvers;
  aim: FrameAim;
};

/**
 * Puts the camera where the frame's mode, look, focus and sights place it — keeping the zoom for
 * mouse-look — then shakes and sways it as the 2D view would (`cameraFeel.ts`).
 */
function placeCamera(
  camera: Renderer3d["camera"],
  frame: View3dFrame,
  focus: Focus,
  aim: FrameAim,
): void {
  const pose = rigPose({
    mode: frame.mode,
    yaw: frame.yaw,
    pitch: frame.pitch,
    target: focus,
    driving: focus.driving,
    dead: frame.deadSeconds !== null,
    deadSeconds: frame.deadSeconds ?? 0,
    dt: frame.dt,
    sights: aim.cast.sights,
    weapon: aim.weapon,
  });
  aim.zoom = pose.zoom;
  applyRigPose(camera, pose);
  applyCameraFeel(camera, cameraFeelOf(frame.scene));
}

/**
 * Starts the collapse of the buildings that just fell (found by comparing the frame's structure
 * list with the last one), lays the rubble, and knocks over the furniture next to fast cars and
 * new explosions. The destruction exists from the cast's first update on.
 */
function wreck(parts: View3dParts, frame: View3dFrame): void {
  const destruction = parts.cast.destruction();
  if (!destruction) return;
  const { scene, structures, tiles } = frame;
  parts.ruins.update(structures, tiles, scene.tick, destruction);
  parts.knocks.update(scene, parts.city, destruction);
}

/**
 * Raises or lowers the sights; places the camera and probes what the crosshair covers; reads the
 * mission markers; syncs the cast (characters, mission contacts, vehicles, pickups, effects,
 * destruction, the hands with their sights) and the guidance; streams the city, which rebuilds
 * the cells a building fell in and copies the knocked furniture's poses; then starts the collapses
 * (in the frame the real building is dropped) and knocks furniture over. The knocks come after
 * the city, so a blast that brings a building down knocks the rebuilt cell's pieces, not the ones
 * the rebuild just threw away. Then it renders, the first-person hands in a pass of their own over
 * the city, and draws the HUD (the crosshair, or the rifle's scope).
 */
function renderFrame(
  parts: View3dParts,
  frame: View3dFrame,
  overlay: CanvasRenderingContext2D,
): void {
  const focus = focusOf(frame.scene);
  const { renderer, city, cast, markers } = parts;
  renderer.configure(frame.size, frame.quality);
  raiseSights(parts.aim, frame, localWeapon(frame.scene));
  placeCamera(renderer.camera, frame, focus, parts.aim);
  probeFrame(parts.aim, renderer.camera, frame, focus);
  markers.update(frame.scene);
  const hands = cast.update(
    frame,
    focus,
    renderer.camera,
    markers.contacts,
    parts.aim.cast,
  );
  parts.guidance.update(frame, focus, renderer.camera, markers.beacons);
  city.update(focus, frame);
  wreck(parts, frame);
  renderer.render(hands);
  drawOverlay3d(overlay, renderer.camera, {
    origin: focus,
    size: frame.size,
    dead: frame.deadSeconds !== null,
    friends: frame.scene,
    scope: scopeOf(parts.aim, frame, focus.driving === null),
  });
}

/**
 * Starts the 3D view on `canvas` (spec §6): renderer, sky, lights and fog; the streamed city of
 * the loaded map tiles; the characters, mission contacts, vehicles, pickups, effects, destruction
 * and first-person hands; the route, beacons, zone wall and friends' markers.
 *
 * @param canvas - The WebGL canvas stacked under the 2D HUD canvas.
 * @returns The live view.
 * @throws {WebGl2UnavailableError} When WebGL2 is unavailable — the caller falls back to 2D.
 */
export function createView3d(canvas: HTMLCanvasElement): View3dHandle {
  const renderer = createRenderer3d(canvas);
  let parts: View3dParts | null = null;
  try {
    parts = {
      renderer,
      city: createCity3d(),
      cast: createCast3d(),
      guidance: createGuidance3d(),
      markers: createMissionMarkers(),
      ruins: createRuins3d(),
      knocks: createKnockOvers(),
      aim: createFrameAim(),
    };
  } finally {
    // A layer that fails to start (say, no 2D canvas to paint the façades on) must not leave the
    // WebGL context behind; the error itself goes on to the caller, which reports it.
    if (!parts) renderer.dispose();
  }
  return startView(parts);
}

/** Puts the layers in the scene and hands out the view. */
function startView(parts: View3dParts): View3dHandle {
  const { renderer } = parts;
  renderer.scene.add(
    parts.city.object,
    parts.cast.object,
    parts.guidance.object,
  );
  return {
    render: (frame, overlay) => renderFrame(parts, frame, overlay),
    aimPoint: () => (parts.aim.shown ? parts.aim.point : null),
    lookZoom: () => parts.aim.zoom,
    dispose() {
      parts.city.dispose();
      parts.cast.dispose();
      parts.guidance.dispose();
      // Before the renderer: freeing them lets its dispose listeners let go of them.
      disposeSharedAssets();
      renderer.dispose();
    },
  };
}
