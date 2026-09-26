"use client";
/**
 * Switches the 3D view on and off (spec §6.1, §7): while the settings ask for 3D it loads
 * `render3d/` through a dynamic `import()` — so three.js stays out of the 2D bundle — starts it on
 * a fresh WebGL canvas, binds mouse-look to the 2D canvas above, and hands both to the runtime.
 * When the view cannot start or breaks, it shows a toast and returns to 2D; a device without
 * WebGL2 is expected and leaves only a breadcrumb, every other failure goes to Sentry.
 */
import * as Sentry from "@sentry/nextjs";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  attachMouseLook,
  type LockState,
  type MouseLook,
} from "@/lib/cityArena/input/mouseLook";
import type { CameraMode, View3dHandle } from "@/lib/cityArena/render3d";
import { occupiedVehicle } from "@/lib/cityArena/sim/boarding";
import { playerById } from "@/lib/cityArena/sim/players";
import { isWebGl2Unavailable } from "@/lib/cityArena/webgl2";
import { reportArenaError, type Runtime } from "../arenaRuntime";

/** The toast shown when the 3D view cannot start or breaks (spec §7). */
export const VIEW3D_FAILED_TEXT = "3D werkt niet op dit apparaat";
/** How long the toast stays up, milliseconds. */
export const VIEW3D_NOTICE_MS = 4000;
/** Classes of the WebGL canvas the view renders into; it fills its layer. */
const GL_CANVAS_CLASS = "block h-full w-full";

/** The lazily loaded 3D module. */
type Render3dModule = typeof import("@/lib/cityArena/render3d");

/** A 3D view attached to a runtime. */
type Attached = {
  look: MouseLook;
  module: Render3dModule;
  /** Takes the view off the runtime and frees it. */
  detach(): void;
};

/** What the hook reacts to from outside: the settings' fallback and the pause menu. */
type View3dCallbacks = {
  onFallback: () => void;
  onPause: () => void;
  onLockChange: (state: LockState) => void;
};

/** The heading the camera starts behind: the car's when driving, else where the player faces. */
function startYaw(runtime: Runtime): number {
  const player = playerById(runtime.state, runtime.netplay.playerId);
  if (!player) return 0;
  return occupiedVehicle(runtime.state, player)?.heading ?? player.facing;
}

/**
 * Reports a 3D failure: a device without WebGL2 is expected and leaves a breadcrumb (AGENTS.md
 * Sentry-noise policy), anything else is a real error.
 *
 * @param error - What the import, the start or a frame threw.
 */
export function reportView3dFailure(error: unknown): void {
  if (!isWebGl2Unavailable(error)) {
    reportArenaError(error, "render3d");
    return;
  }
  Sentry.addBreadcrumb({
    category: "arena",
    level: "warning",
    message: "3D view unavailable: no WebGL2; staying in 2D",
  });
}

/**
 * Wraps a view so a frame that throws takes the view off the runtime (the next frame paints 2D)
 * and reports once, instead of stopping the frame loop.
 *
 * @param handle - The view from `createView3d`.
 * @param runtime - The runtime it is attached to.
 * @param onFailure - Reports and falls back; called at most once.
 * @returns The guarded view.
 */
export function guardView3d(
  handle: View3dHandle,
  runtime: Runtime,
  onFailure: (error: unknown) => void,
): View3dHandle {
  let failed = false;
  return {
    render(frame, overlay) {
      if (failed) return;
      try {
        handle.render(frame, overlay);
      } catch (error) {
        failed = true;
        runtime.view3d = null;
        runtime.look = null;
        onFailure(error);
      }
    },
    dispose: () => handle.dispose(),
  };
}

/** What {@link attachView3d} works with. */
type AttachInput = {
  module: Render3dModule;
  gl: HTMLCanvasElement;
  hud: HTMLCanvasElement;
  runtime: Runtime;
  mode: CameraMode;
  callbacks: View3dCallbacks;
  onFailure: (error: unknown) => void;
};

/** Mouse-look on `hud`, facing where the player does, within the mode's pitch range. */
function startLook(input: AttachInput): MouseLook {
  const { runtime, callbacks } = input;
  const limits = input.module.pitchLimitsFor(input.mode);
  const yaw = startYaw(runtime);
  const look = attachMouseLook(input.hud, {
    onGesture: () => runtime.sound.unlock(),
    onLockLost: callbacks.onPause,
    onLockChange: callbacks.onLockChange,
  });
  look.setYaw(yaw);
  look.setPitchLimits(...limits);
  return look;
}

/**
 * Starts the view on `gl`, mouse-look on `hud`, and hands both to the runtime. If mouse-look
 * fails after the view started, the view is freed before the error travels on to be reported.
 */
function attachView3d(input: AttachInput): Attached {
  const view = input.module.createView3d(input.gl);
  let look: MouseLook | undefined;
  try {
    look = startLook(input);
  } finally {
    if (!look) view.dispose();
  }
  return handOver(
    input,
    guardView3d(view, input.runtime, input.onFailure),
    look,
  );
}

/** Puts a started view and its mouse-look on the runtime; the returned detach undoes it. */
function handOver(
  input: AttachInput,
  handle: View3dHandle,
  look: MouseLook,
): Attached {
  const { runtime } = input;
  runtime.view3d = handle;
  runtime.look = look;
  runtime.carLook = undefined;
  runtime.aim3d = undefined;
  input.callbacks.onLockChange({
    locked: look.locked(),
    lockFree: look.lockFree(),
  });
  return {
    look,
    module: input.module,
    detach() {
      if (runtime.view3d === handle) {
        runtime.view3d = null;
        runtime.look = null;
      }
      look.detach();
      handle.dispose();
      input.callbacks.onLockChange({ locked: false, lockFree: false });
    },
  };
}

/** Loads the 3D module — the one dynamic `import()` that keeps three.js out of the 2D bundle. */
function loadRender3d(): Promise<Render3dModule> {
  return import("@/lib/cityArena/render3d");
}

/** What {@link mountView3d} needs; the refs are read when the module arrives. */
export type MountOptions = {
  layer: HTMLElement;
  hud: HTMLCanvasElement;
  runtimeRef: RefObject<Runtime | null>;
  modeRef: RefObject<CameraMode>;
  attachedRef: RefObject<Attached | null>;
  callbacks: View3dCallbacks;
  onFailure: (error: unknown) => void;
  /** Loads the 3D module; the dynamic import unless a test hands in another. */
  load?: () => Promise<Render3dModule>;
};

/**
 * Loads the 3D module and attaches the view to a canvas made for this mount — a disposed view
 * kills its WebGL context, so a canvas is never reused. Returns the cleanup that undoes it all;
 * a failure that arrives after the cleanup is still reported, without a toast or a fallback.
 *
 * @param options - The layer, canvases, refs and callbacks.
 * @returns The cleanup.
 */
export function mountView3d(options: MountOptions): () => void {
  let cancelled = false;
  const gl = document.createElement("canvas");
  gl.className = GL_CANVAS_CLASS;
  options.layer.appendChild(gl);
  (options.load ?? loadRender3d)()
    .then((module) => {
      const runtime = options.runtimeRef.current;
      if (cancelled || !runtime) return;
      options.attachedRef.current = attachView3d({
        module,
        gl,
        hud: options.hud,
        runtime,
        mode: options.modeRef.current,
        callbacks: options.callbacks,
        onFailure: options.onFailure,
      });
    })
    .catch((error: unknown) =>
      cancelled ? reportView3dFailure(error) : options.onFailure(error),
    );
  return () => {
    cancelled = true;
    options.attachedRef.current?.detach();
    options.attachedRef.current = null;
    gl.remove();
  };
}

/** A message that clears itself after {@link VIEW3D_NOTICE_MS}. */
function useNotice(): [string | null, (text: string) => void] {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (notice === null) return undefined;
    const timer = setTimeout(() => setNotice(null), VIEW3D_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice];
}

/** Keeps a ref pointing at the latest `value`, for callbacks read long after a render. */
function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/** Options for {@link useView3d}. */
export type UseView3dOptions = {
  /** Playing, the settings ask for 3D, and the screen is not shared. */
  active: boolean;
  /** Bumped whenever a new runtime boots, so the view moves to it. */
  epoch: number;
  mode: CameraMode;
  runtimeRef: RefObject<Runtime | null>;
  /** The playfield's 2D canvas: the HUD layer, and where mouse-look locks the pointer. */
  hudCanvasRef: RefObject<HTMLCanvasElement | null>;
  /** Switches the settings back to 2D. */
  onFallback: () => void;
  /** Opens the game menu: the player let go of the pointer lock (the browser's first Esc). */
  onPause: () => void;
};

/** What the overlay renders for the 3D view. */
export type View3dControls = LockState & {
  /** Attach to the layer under the 2D canvas; the view puts its own WebGL canvas in it. */
  layerRef: RefObject<HTMLDivElement | null>;
  /** True while the 3D view is meant to run. */
  active: boolean;
  /** The failure toast, or `null`. */
  notice: string | null;
};

/**
 * Runs the 3D view while `active` (spec §6): see the module comment. The pitch range follows the
 * camera mode (−35°…+40° third person, ±30° first person).
 *
 * @param options - When to run, the runtime and canvases, and how to fall back and pause.
 * @returns The layer ref, the failure toast and the pointer-lock state.
 */
export function useView3d(options: UseView3dOptions): View3dControls {
  const { active, epoch, mode, runtimeRef, hudCanvasRef } = options;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const attachedRef = useRef<Attached | null>(null);
  const modeRef = useLatest(mode);
  const onFallbackRef = useLatest(options.onFallback);
  const onPauseRef = useLatest(options.onPause);
  const [notice, showNotice] = useNotice();
  const [lock, setLock] = useState<LockState>({
    locked: false,
    lockFree: false,
  });
  useEffect(() => {
    const attached = attachedRef.current;
    attached?.look.setPitchLimits(...attached.module.pitchLimitsFor(mode));
  }, [mode]);
  useEffect(() => {
    const layer = layerRef.current;
    const hud = hudCanvasRef.current;
    if (!active || !layer || !hud) return undefined;
    return mountView3d({
      layer,
      hud,
      runtimeRef,
      modeRef,
      attachedRef,
      callbacks: {
        onFallback: () => onFallbackRef.current(),
        onPause: () => onPauseRef.current(),
        onLockChange: setLock,
      },
      onFailure(error) {
        reportView3dFailure(error);
        showNotice(VIEW3D_FAILED_TEXT);
        onFallbackRef.current();
      },
    });
  }, [
    active,
    epoch,
    hudCanvasRef,
    runtimeRef,
    modeRef,
    onFallbackRef,
    onPauseRef,
    showNotice,
  ]);
  return { layerRef, active, notice, ...lock };
}
