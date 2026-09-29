"use client";
/**
 * Switches the 3D view on and off (spec §6.1, §7): while the settings ask for 3D it loads
 * `render3d/` through a dynamic `import()` — so three.js stays out of the 2D bundle — starts it on
 * a fresh WebGL canvas, binds mouse-look to the 2D canvas above, and hands both to the runtime.
 * When the view cannot start or breaks, it shows a toast and returns to 2D; a device without
 * WebGL2 (asked before three.js is even downloaded) and a chunk that failed to download are
 * expected and leave only a breadcrumb, every other failure goes to Sentry.
 */
import * as Sentry from "@sentry/nextjs";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { InputState } from "@/lib/cityArena/input/inputState";
import {
  attachMouseLook,
  type LockState,
  type MouseLook,
} from "@/lib/cityArena/input/mouseLook";
import {
  createTouchCamera,
  createTouchLook,
  type TouchCamera,
  type TouchLook,
} from "@/lib/cityArena/input/touchLook";
import type { CameraMode, View3dHandle } from "@/lib/cityArena/render3d";
import { occupiedVehicle } from "@/lib/cityArena/sim/boarding";
import { playerById } from "@/lib/cityArena/sim/players";
import { isChunkLoadError } from "@/lib/cityArena/chunkLoadError";
import {
  hasWebGl2,
  isWebGl2Unavailable,
  WebGl2UnavailableError,
} from "@/lib/cityArena/webgl2";
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
  /** The touch look pad as the frame keeps it; its pitch range follows the mode like `look`'s. */
  touch: TouchCamera;
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

/** The breadcrumb for a 3D failure that is expected on some devices or deploys, else `null`. */
function expectedFailure(error: unknown): string | null {
  if (isWebGl2Unavailable(error))
    return "3D view unavailable: no WebGL2; staying in 2D";
  if (isChunkLoadError(error))
    return "3D view chunk failed to download; staying in 2D";
  return null;
}

/**
 * Reports a 3D failure: a device without WebGL2, or the 3D chunk failing to download (a tab still
 * on the previous deploy, a dropped connection), is expected and leaves a breadcrumb (AGENTS.md
 * Sentry-noise policy); anything else is a real error.
 *
 * @param error - What the import, the start or a frame threw.
 */
export function reportView3dFailure(error: unknown): void {
  const expected = expectedFailure(error);
  if (expected === null) {
    reportArenaError(error, "render3d");
    return;
  }
  Sentry.addBreadcrumb({
    category: "arena",
    level: "warning",
    message: expected,
    data: { error: error instanceof Error ? error.name : String(error) },
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
        runtime.touchCamera = null;
        onFailure(error);
      }
    },
    aimPoint: () => handle.aimPoint(),
    lookZoom: () => handle.lookZoom(),
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
  /** Where the right button's sights go. */
  input: InputState;
  callbacks: View3dCallbacks;
  onFailure: (error: unknown) => void;
  /** The touch look pad; the frame reads it through `runtime.touchCamera` while the view runs. */
  touchPad: TouchLook;
};

/**
 * Mouse-look on `hud`, facing where the player does, within the mode's pitch range, its right
 * button aiming down the sights through the input state.
 */
function startLook(input: AttachInput): MouseLook {
  const { runtime, callbacks } = input;
  const limits = input.module.pitchLimitsFor(input.mode);
  const yaw = startYaw(runtime);
  const look = attachMouseLook(input.hud, {
    onGesture: () => runtime.sound.unlock(),
    onLockLost: callbacks.onPause,
    onLockChange: callbacks.onLockChange,
    input: input.input,
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
  // A drag made while the module loaded had no camera to turn; it must not jump the first frame.
  input.touchPad.take();
  const touch = createTouchCamera(
    input.touchPad,
    input.module.pitchLimitsFor(input.mode),
  );
  runtime.view3d = handle;
  runtime.look = look;
  runtime.touchCamera = touch;
  runtime.carLook = undefined;
  runtime.aim3d = undefined;
  input.callbacks.onLockChange({
    locked: look.locked(),
    lockFree: look.lockFree(),
  });
  return {
    look,
    touch,
    module: input.module,
    detach() {
      if (runtime.view3d === handle) {
        runtime.view3d = null;
        runtime.look = null;
        runtime.touchCamera = null;
      }
      input.touchPad.reset();
      look.detach();
      handle.dispose();
      input.callbacks.onLockChange({ locked: false, lockFree: false });
    },
  };
}

/**
 * Loads the 3D module — the one dynamic `import()` that keeps three.js out of the 2D bundle —
 * after checking the device has WebGL2 at all, so one without it never downloads three.js.
 */
function loadRender3d(): Promise<Render3dModule> {
  return Promise.resolve().then(() => {
    if (!hasWebGl2()) throw new WebGl2UnavailableError();
    return import("@/lib/cityArena/render3d");
  });
}

/** What {@link mountView3d} needs; the refs are read when the module arrives. */
export type MountOptions = {
  layer: HTMLElement;
  hud: HTMLCanvasElement;
  runtimeRef: RefObject<Runtime | null>;
  modeRef: RefObject<CameraMode>;
  /** The input state the right button's sights are written to. */
  inputRef: RefObject<InputState>;
  attachedRef: RefObject<Attached | null>;
  callbacks: View3dCallbacks;
  onFailure: (error: unknown) => void;
  /** The touch look pad handed to the runtime with the view. */
  touchPad: TouchLook;
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
        input: options.inputRef.current,
        callbacks: options.callbacks,
        onFailure: options.onFailure,
        touchPad: options.touchPad,
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
  /** The input state the right button aims down the sights through (aim spec §5). */
  inputRef: RefObject<InputState>;
  /** The playfield's 2D canvas: the HUD layer, and where mouse-look locks the pointer. */
  hudCanvasRef: RefObject<HTMLCanvasElement | null>;
  /** Switches the settings back to 2D. */
  onFallback: () => void;
  /** Opens the game menu: the player let go of the pointer lock (the browser's first Esc). */
  onPause: () => void;
  /** "Kijkgevoeligheid": scales the touch look pad's turn per pixel; 1 when absent. */
  touchLookSensitivity?: number;
};

/** What the overlay renders for the 3D view. */
export type View3dControls = LockState & {
  /** Attach to the layer under the 2D canvas; the view puts its own WebGL canvas in it. */
  layerRef: RefObject<HTMLDivElement | null>;
  /** The touch look pad (spec §6): the look surface and the fire button feed it. Stable. */
  touchLook: TouchLook;
  /** True while the 3D view is meant to run. */
  active: boolean;
  /** The failure toast, or `null`. */
  notice: string | null;
  /**
   * Lets go of the pointer lock without opening the pause menu (`MouseLook.release`), so a menu,
   * the map or a mission offer gets the mouse; a no-op in 2D. Stable across renders.
   */
  release: () => void;
};

/**
 * Lets go of the 3D pointer lock each time `open` turns true — a menu, the map or a mission offer
 * over the playfield needs the mouse to reach its buttons — without the pause menu the player's
 * own Esc opens.
 *
 * @param open - Whether anything modal is open over the playfield.
 * @param release - {@link View3dControls.release}.
 */
export function useReleaseLockWhile(open: boolean, release: () => void): void {
  useEffect(() => {
    if (open) release();
  }, [open, release]);
}

/** The touch look pad, made once; its turn per pixel follows the latest "Kijkgevoeligheid". */
function useTouchPad(sensitivity: number | undefined): TouchLook {
  const [pad] = useState(() => {
    const setting = { scale: 1 };
    return { setting, look: createTouchLook(() => setting.scale) };
  });
  useEffect(() => {
    pad.setting.scale = sensitivity ?? 1;
  }, [pad, sensitivity]);
  return pad.look;
}

/** Re-applies the camera mode's pitch range to a running view whenever the mode changes. */
function usePitchLimits(
  attachedRef: RefObject<Attached | null>,
  mode: CameraMode,
): void {
  useEffect(() => {
    const attached = attachedRef.current;
    if (!attached) return;
    const limits = attached.module.pitchLimitsFor(mode);
    attached.look.setPitchLimits(...limits);
    attached.touch.limits = limits;
  }, [attachedRef, mode]);
}

/**
 * Runs the 3D view while `active` (spec §6): see the module comment. The pitch range follows the
 * camera mode (−35°…+40° third person, ±30° first person).
 *
 * @param options - When to run, the runtime and canvases, and how to fall back and pause.
 * @returns The layer ref, the failure toast and the pointer-lock state.
 */
export function useView3d(options: UseView3dOptions): View3dControls {
  const { active, epoch, mode, runtimeRef, inputRef, hudCanvasRef } = options;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const attachedRef = useRef<Attached | null>(null);
  const modeRef = useLatest(mode);
  const onFallbackRef = useLatest(options.onFallback);
  const onPauseRef = useLatest(options.onPause);
  const [notice, showNotice] = useNotice();
  const touchPad = useTouchPad(options.touchLookSensitivity);
  const [lock, setLock] = useState<LockState>({
    locked: false,
    lockFree: false,
  });
  usePitchLimits(attachedRef, mode);
  useEffect(() => {
    const layer = layerRef.current;
    const hud = hudCanvasRef.current;
    if (!active || !layer || !hud) return undefined;
    return mountView3d({
      layer,
      hud,
      runtimeRef,
      modeRef,
      inputRef,
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
      touchPad,
    });
  }, [
    active,
    epoch,
    hudCanvasRef,
    runtimeRef,
    inputRef,
    modeRef,
    onFallbackRef,
    onPauseRef,
    showNotice,
    touchPad,
  ]);
  const release = useCallback(() => attachedRef.current?.look.release(), []);
  return { layerRef, active, notice, release, touchLook: touchPad, ...lock };
}
