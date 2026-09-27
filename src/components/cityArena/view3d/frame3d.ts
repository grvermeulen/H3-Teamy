"use client";
/**
 * The runtime's 3D frame (spec §6): the camera's yaw turned into the simulation's input, and the
 * paint that hands the blended scene to the lazily loaded 3D view. Only types come from
 * `render3d/`, so this module — imported statically by the frame loop — never pulls three.js
 * into the 2D bundle.
 */
import { cameraRelativeInput } from "@/lib/cityArena/input/cameraInput";
import {
  INITIAL_CAR_LOOK,
  nextCarYaw,
  stickTurnedYaw,
  stickWorldYaw,
} from "@/lib/cityArena/input/cameraYaw";
import type { MouseLook } from "@/lib/cityArena/input/mouseLook";
import type { Rect } from "@/lib/cityArena/mapBuild/geometry";
import type { DrawStats } from "@/lib/cityArena/render/drawWorld";
import { drawFeedback } from "@/lib/cityArena/render/feedback";
import type { Scene } from "@/lib/cityArena/render/renderScene";
import type {
  StructureView,
  View3dFrame,
  View3dHandle,
} from "@/lib/cityArena/render3d";
import { occupiedVehicle } from "@/lib/cityArena/sim/boarding";
import { playerById } from "@/lib/cityArena/sim/players";
import type { WorldInput } from "@/lib/cityArena/sim/types";
import type { Runtime } from "../arenaRuntime";
import { prepareCanvas } from "../hudCanvas";

/** A runtime whose frame is drawn by the 3D view. */
export type Runtime3d = Runtime & { view3d: View3dHandle; look: MouseLook };

/** Milliseconds per second. */
const MS_PER_SECOND = 1000;
/** The 3D view draws no raster chunks, so its paint reports none. */
const NO_RASTER: DrawStats = { missing: 0, rasterised: false, rasterMs: 0 };
/** An untouched city: the simulation lists no damaged or destroyed building yet. */
const NO_STRUCTURES: readonly StructureView[] = [];
/**
 * In 3D the view reaches far past the 2D camera's box, so the simulation's "out of sight" rect —
 * where pedestrians, traffic and officers may appear and vanish — is this far each way around the
 * player instead, metres.
 */
export const VIEW3D_POPULATION_HALF_M = 80;

/**
 * The simulation's out-of-sight rect for a 3D frame: a square {@link VIEW3D_POPULATION_HALF_M}
 * each way around the player.
 *
 * @param player - Where the player stands.
 * @returns The rect the simulation must not spawn or despawn inside.
 */
export function populationRect3d(player: { x: number; y: number }): Rect {
  return {
    minX: player.x - VIEW3D_POPULATION_HALF_M,
    minY: player.y - VIEW3D_POPULATION_HALF_M,
    maxX: player.x + VIEW3D_POPULATION_HALF_M,
    maxY: player.y + VIEW3D_POPULATION_HALF_M,
  };
}

/**
 * The runtime as a 3D one when this frame is drawn in 3D: a view and mouse-look are attached and
 * the screen is not shared — split screen and the TV stay 2D (spec §6.2). Asked once per frame.
 *
 * @param runtime - The runtime.
 * @returns The same runtime, typed for the 3D input and paint path, or `null` for 2D.
 */
export function view3dRuntime(runtime: Runtime): Runtime3d | null {
  return drawsIn3d(runtime) ? runtime : null;
}

/** The test behind {@link view3dRuntime}. */
function drawsIn3d(runtime: Runtime): runtime is Runtime3d {
  return (
    Boolean(runtime.view3d && runtime.look) &&
    !runtime.sharedScreen &&
    !runtime.split
  );
}

/**
 * The simulation input for a 3D frame (spec §6.3–6.4). The camera yaw is the aim; in a car the
 * yaw eases behind the heading once the mouse rests (and rides along with the car in first
 * person, `nextCarYaw`); a touch or gamepad aim stick is read relative to the camera, which
 * turns toward it, and a lone movement stick turns it toward the walk (`stickTurnedYaw`).
 * Movement is then rotated into the camera's frame.
 *
 * @param runtime - The 3D runtime; its yaw, car-camera memory and sent aim are updated.
 * @param live - This frame's merged keyboard, pointer, stick and gamepad input.
 * @param dt - Seconds since the previous frame.
 * @returns The input to step the world with.
 */
export function input3d(
  runtime: Runtime3d,
  live: WorldInput,
  dt: number,
): WorldInput {
  const { look } = runtime;
  const player = playerById(runtime.state, runtime.netplay.playerId);
  const car = player ? occupiedVehicle(runtime.state, player) : null;
  const next = nextCarYaw({
    yaw: look.yaw(),
    yawDelta: look.takeYawDelta(),
    heading: car?.heading ?? null,
    mode: runtime.camera3d ?? "third",
    dt,
    state: runtime.carLook ?? INITIAL_CAR_LOOK,
  });
  runtime.carLook = next.state;
  const aim = live.aim === null ? next.yaw : stickWorldYaw(next.yaw, live.aim);
  const yaw = stickTurnedYaw(next.yaw, live, car !== null, dt);
  look.setYaw(yaw);
  runtime.aim3d = aim;
  return cameraRelativeInput(live, yaw, car !== null, aim);
}

/** The frame the 3D view renders from the runtime and the blended scene. */
function view3dFrame(
  runtime: Runtime3d,
  scene: Scene,
  size: { width: number; height: number },
  nowMs: number,
  dt: number,
): View3dFrame {
  return {
    scene,
    tiles: scene.world.tiles,
    structures: runtime.state.structures ?? NO_STRUCTURES,
    yaw: runtime.look.yaw(),
    pitch: runtime.look.pitch(),
    aim: runtime.aim3d ?? runtime.look.yaw(),
    mode: runtime.camera3d ?? "third",
    dt,
    nowMs,
    deadSeconds:
      runtime.diedAtMs === null
        ? null
        : (nowMs - runtime.diedAtMs) / MS_PER_SECOND,
    quality: runtime.quality,
    size,
  };
}

/**
 * Paints a 3D frame (spec §6.2): the 2D canvas is sized and cleared as in 2D and becomes the
 * transparent HUD layer, the 3D view renders the scene underneath and its crosshair on top, and
 * the feedback vignette is drawn last, exactly as the 2D paint does.
 *
 * @param canvas - The playfield's 2D canvas.
 * @param rect - Its layout box.
 * @param runtime - The 3D runtime.
 * @param scene - The blended scene the 2D renderer would have drawn.
 * @param nowMs - The frame clock.
 * @param dt - Seconds since the previous frame.
 * @returns Draw stats; the 3D view rasterises no chunks.
 */
export function paint3d(
  canvas: HTMLCanvasElement,
  rect: DOMRect,
  runtime: Runtime3d,
  scene: Scene,
  nowMs: number,
  dt: number,
): DrawStats {
  const context = prepareCanvas(canvas, rect, runtime.renderScale);
  if (!context) return NO_RASTER;
  const size = { width: rect.width, height: rect.height };
  runtime.view3d.render(view3dFrame(runtime, scene, size, nowMs, dt), context);
  drawFeedback(context, size, runtime.feedback);
  return NO_RASTER;
}
