"use client";
/**
 * Switches the 3D view on and off (spec §6.1, §7): while the settings ask for 3D it loads
 * `render3d/` through a dynamic `import()` — so three.js stays out of the 2D bundle — starts it on
 * the WebGL canvas, binds mouse-look to the 2D canvas above, and hands both to the runtime. When
 * WebGL is missing or the view fails, it reports to Sentry, shows a toast and returns to 2D.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  attachMouseLook,
  type MouseLook,
} from "@/lib/cityArena/input/mouseLook";
import type { View3dHandle } from "@/lib/cityArena/render3d";
import type { ArenaSettings } from "@/lib/cityArena/schemas";
import { occupiedVehicle } from "@/lib/cityArena/sim/boarding";
import { playerById } from "@/lib/cityArena/sim/players";
import { reportArenaError, type Runtime } from "../arenaRuntime";

/** The toast shown when the 3D view cannot start or breaks (spec §7). */
export const VIEW3D_FAILED_TEXT = "3D werkt niet op dit apparaat";
/** How long the toast stays up, milliseconds. */
export const VIEW3D_NOTICE_MS = 4000;

/** The lazily loaded 3D module. */
type Render3dModule = typeof import("@/lib/cityArena/render3d");
/** A 3D camera mode. */
type CameraMode = ArenaSettings["camera3d"];

/** A 3D view attached to a runtime. */
type Attached = {
  look: MouseLook;
  module: Render3dModule;
  /** Takes the view off the runtime and frees it. */
  detach(): void;
};

/** The heading the camera starts behind: the car's when driving, else where the player faces. */
function startYaw(runtime: Runtime): number {
  const player = playerById(runtime.state, runtime.netplay.playerId);
  if (!player) return 0;
  return occupiedVehicle(runtime.state, player)?.heading ?? player.facing;
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

/** Starts the view on `glCanvas`, mouse-look on `hudCanvas`, and hands both to `runtime`. */
function attachView3d(
  module: Render3dModule,
  canvases: { gl: HTMLCanvasElement; hud: HTMLCanvasElement },
  runtime: Runtime,
  mode: CameraMode,
  onFailure: (error: unknown) => void,
): Attached {
  const handle = guardView3d(
    module.createView3d(canvases.gl),
    runtime,
    onFailure,
  );
  const look = attachMouseLook(canvases.hud, () => runtime.sound.unlock());
  look.setYaw(startYaw(runtime));
  look.setPitchLimits(...module.pitchLimitsFor(mode));
  runtime.view3d = handle;
  runtime.look = look;
  runtime.carLook = undefined;
  return {
    look,
    module,
    detach() {
      if (runtime.view3d === handle) {
        runtime.view3d = null;
        runtime.look = null;
      }
      look.detach();
      handle.dispose();
      if (document.pointerLockElement === canvases.hud)
        document.exitPointerLock();
    },
  };
}

/** What {@link mountView3d} needs; the refs are read when the import resolves. */
type MountOptions = {
  canvases: { gl: HTMLCanvasElement; hud: HTMLCanvasElement };
  runtimeRef: RefObject<Runtime | null>;
  modeRef: RefObject<CameraMode>;
  attachedRef: RefObject<Attached | null>;
  onFailure: (error: unknown) => void;
};

/** Loads the 3D module and attaches the view; returns the cleanup that undoes either step. */
function mountView3d(options: MountOptions): () => void {
  let cancelled = false;
  import("@/lib/cityArena/render3d")
    .then((module) => {
      const runtime = options.runtimeRef.current;
      if (cancelled || !runtime) return;
      options.attachedRef.current = attachView3d(
        module,
        options.canvases,
        runtime,
        options.modeRef.current,
        options.onFailure,
      );
    })
    .catch((error: unknown) => {
      if (!cancelled) options.onFailure(error);
    });
  return () => {
    cancelled = true;
    options.attachedRef.current?.detach();
    options.attachedRef.current = null;
  };
}

/** True while the pointer is locked to the element in `targetRef`. */
function usePointerLocked(
  targetRef: RefObject<HTMLCanvasElement | null>,
): boolean {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const update = (): void =>
      setLocked(
        targetRef.current !== null &&
          document.pointerLockElement === targetRef.current,
      );
    document.addEventListener("pointerlockchange", update);
    return () => document.removeEventListener("pointerlockchange", update);
  }, [targetRef]);
  return locked;
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
};

/** What the overlay renders for the 3D view. */
export type View3dControls = {
  /** Attach to the WebGL `<canvas>` under the 2D one. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** The failure toast, or `null`. */
  notice: string | null;
  /** True while mouse-look holds the pointer. */
  locked: boolean;
};

/**
 * Runs the 3D view while `active` (spec §6): see the module comment. The pitch range follows the
 * camera mode (−35°…+40° third person, ±30° first person).
 *
 * @param options - When to run, the runtime and canvases, and how to fall back.
 * @returns The WebGL canvas ref, the failure toast and the pointer-lock state.
 */
export function useView3d(options: UseView3dOptions): View3dControls {
  const { active, epoch, mode, runtimeRef, hudCanvasRef, onFallback } = options;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const attachedRef = useRef<Attached | null>(null);
  const modeRef = useRef(mode);
  const onFallbackRef = useRef(onFallback);
  const [notice, showNotice] = useNotice();
  const locked = usePointerLocked(hudCanvasRef);
  useEffect(() => {
    onFallbackRef.current = onFallback;
  }, [onFallback]);
  useEffect(() => {
    modeRef.current = mode;
    const attached = attachedRef.current;
    attached?.look.setPitchLimits(...attached.module.pitchLimitsFor(mode));
  }, [mode]);
  useEffect(() => {
    const gl = canvasRef.current;
    const hud = hudCanvasRef.current;
    if (!active || !gl || !hud) return undefined;
    return mountView3d({
      canvases: { gl, hud },
      runtimeRef,
      modeRef,
      attachedRef,
      onFailure(error) {
        reportArenaError(error, "render3d");
        showNotice(VIEW3D_FAILED_TEXT);
        onFallbackRef.current();
      },
    });
  }, [active, epoch, hudCanvasRef, runtimeRef, showNotice]);
  return { canvasRef, notice, locked };
}
