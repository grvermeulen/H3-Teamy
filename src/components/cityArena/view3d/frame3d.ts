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
  STICK_TURN_PER_S,
  easeYaw,
  nextCarYaw,
  stickWorldYaw,
} from "@/lib/cityArena/input/cameraYaw";
import type { MouseLook } from "@/lib/cityArena/input/mouseLook";
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
/** Until the simulation's structures reach this branch, the 3D view sees an intact city. */
const NO_STRUCTURES: readonly StructureView[] = [];

/**
 * True when this frame is drawn in 3D: a view and mouse-look are attached and the screen is not
 * shared — split screen and the TV stay 2D (spec §6.2).
 *
 * @param runtime - The runtime.
 * @returns Whether to take the 3D input and paint path.
 */
export function isView3dFrame(runtime: Runtime): runtime is Runtime3d {
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
 * turns toward it. Movement is then rotated into the camera's frame.
 *
 * @param runtime - The 3D runtime; its yaw and car-camera memory are updated.
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
  const yaw =
    live.aim === null ? next.yaw : easeYaw(next.yaw, aim, STICK_TURN_PER_S, dt);
  look.setYaw(yaw);
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
    structures: NO_STRUCTURES,
    yaw: runtime.look.yaw(),
    pitch: runtime.look.pitch(),
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
