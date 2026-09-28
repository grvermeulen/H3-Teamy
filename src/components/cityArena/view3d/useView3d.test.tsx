import * as Sentry from "@sentry/nextjs";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { View3dFrame, View3dHandle } from "@/lib/cityArena/render3d";
import { fakeGetContext } from "@/lib/cityArena/render/testing/fakeContext";
import { WebGl2UnavailableError } from "@/lib/cityArena/webgl2";
import type { Runtime } from "../arenaRuntime";
import {
  VIEW3D_FAILED_TEXT,
  VIEW3D_NOTICE_MS,
  mountView3d,
  reportView3dFailure,
  useReleaseLockWhile,
  useView3d,
} from "./useView3d";

// Hoisted so the module factory below can hand them out (Vitest hoists `vi.mock`).
const mockCreateView3d = vi.hoisted(() => vi.fn());
const mockPitchLimitsFor = vi.hoisted(() =>
  vi.fn((mode: "third" | "first") =>
    mode === "third" ? [-0.6, 0.7] : [-0.5, 0.5],
  ),
);

vi.mock("@/lib/cityArena/render3d", () => ({
  createView3d: mockCreateView3d,
  pitchLimitsFor: mockPitchLimitsFor,
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

/** Stubs `document.pointerLockElement`, which jsdom does not implement. */
function stubPointerLock(target: Element | null): void {
  Object.defineProperty(document, "pointerLockElement", {
    configurable: true,
    get: () => target,
  });
}

/** A handle whose calls the tests inspect. */
function fakeHandle(): View3dHandle & {
  render: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return { render: vi.fn(), dispose: vi.fn() };
}

/** A runtime whose player faces `facing`. */
function fakeRuntime(facing = 1.1): Runtime {
  return {
    state: {
      players: [{ id: 0, x: 0, y: 0, facing, vehicleId: null }],
      vehicles: [],
    },
    netplay: { kind: "offline", playerId: 0 },
    sound: { unlock: vi.fn() },
  } as unknown as Runtime;
}

/** The props the tests change between renders. */
type Props = {
  active: boolean;
  mode: "third" | "first";
  epoch: number;
  touchLookSensitivity?: number;
};

/** Renders the hook, switched off, with a layer and a HUD canvas in place. */
function renderView3d(facing = 1.1) {
  const runtimeRef = { current: fakeRuntime(facing) };
  const hud = document.createElement("canvas");
  hud.requestPointerLock = vi.fn(() => Promise.resolve());
  const hudCanvasRef = { current: hud };
  const onFallback = vi.fn();
  const onPause = vi.fn();
  const hook = renderHook(
    (props: Props) =>
      useView3d({
        ...props,
        runtimeRef,
        hudCanvasRef,
        onFallback,
        onPause,
      }),
    { initialProps: { active: false, mode: "third", epoch: 0 } as Props },
  );
  const layer = document.createElement("div");
  hook.result.current.layerRef.current = layer;
  const on = (overrides: Partial<Props> = {}): void =>
    hook.rerender({ active: true, mode: "third", epoch: 0, ...overrides });
  return { ...hook, runtimeRef, hud, layer, onFallback, onPause, on };
}

describe("useView3d", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPointerLock(null);
    document.exitPointerLock = vi.fn();
    // jsdom has no WebGL; a desktop browser does, so the probe before the download passes.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      fakeGetContext(),
    );
  });

  afterEach(() => {
    stubPointerLock(null);
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("never downloads three.js on a device without WebGL2: a toast, a fallback, no Sentry error", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { result, onFallback, on } = renderView3d();
    on();
    await waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));
    expect(mockCreateView3d).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "3D view unavailable: no WebGL2; staying in 2D",
      }),
    );
    expect(result.current.notice).toBe(VIEW3D_FAILED_TEXT);
  });

  it("starts the view on a fresh canvas in the layer, behind the player, and frees both in 2D", async () => {
    const handle = fakeHandle();
    mockCreateView3d.mockReturnValue(handle);
    const { rerender, runtimeRef, layer, on } = renderView3d(1.1);
    on();
    const runtime = runtimeRef.current;
    await waitFor(() => expect(runtime.view3d).toBeTruthy());
    const canvas = mockCreateView3d.mock.calls[0]![0] as HTMLCanvasElement;
    expect(canvas.parentElement).toBe(layer);
    expect(runtime.look!.yaw()).toBeCloseTo(1.1);
    rerender({ active: false, mode: "third", epoch: 0 });
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(runtime.view3d).toBeNull();
    expect(runtime.look).toBeNull();
    expect(layer.children).toHaveLength(0);
  });

  it("moves to the new runtime on a new canvas when another boot replaces the runtime", async () => {
    const first = fakeHandle();
    const second = fakeHandle();
    mockCreateView3d.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { runtimeRef, layer, on } = renderView3d();
    on();
    const oldRuntime = runtimeRef.current;
    await waitFor(() => expect(oldRuntime.view3d).toBeTruthy());
    runtimeRef.current = fakeRuntime(2);
    on({ epoch: 1 });
    await waitFor(() => expect(runtimeRef.current.view3d).toBeTruthy());
    const [[firstCanvas], [secondCanvas]] = mockCreateView3d.mock.calls;
    // The disposed view killed the first canvas's WebGL context: never reuse it.
    expect(secondCanvas).not.toBe(firstCanvas);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(oldRuntime.view3d).toBeNull();
    expect([...layer.children]).toEqual([secondCanvas]);
    expect(runtimeRef.current.look!.yaw()).toBeCloseTo(2);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("narrows the pitch range when the camera moves behind the eyes", async () => {
    mockCreateView3d.mockReturnValue(fakeHandle());
    const { runtimeRef, hud, on } = renderView3d();
    on();
    await waitFor(() => expect(runtimeRef.current.look).toBeTruthy());
    stubPointerLock(hud);
    hud.dispatchEvent(new MouseEvent("pointermove", { movementY: -5000 }));
    expect(runtimeRef.current.look!.pitch()).toBeCloseTo(0.7);
    on({ mode: "first" });
    expect(runtimeRef.current.look!.pitch()).toBeCloseTo(0.5);
  });

  it("hands the runtime the touch look pad in the mode's pitch range, and takes it back in 2D", async () => {
    mockCreateView3d.mockReturnValue(fakeHandle());
    const { result, rerender, runtimeRef, on } = renderView3d();
    // A drag made while the 3D module loads has no camera yet, and must not jump the first frame.
    result.current.touchLook.onDown({ pointerId: 9, clientX: 0, clientY: 0 });
    result.current.touchLook.onMove({ pointerId: 9, clientX: 80, clientY: 0 });
    result.current.touchLook.onUp({ pointerId: 9, clientX: 80, clientY: 0 });
    on();
    await waitFor(() => expect(runtimeRef.current.touchCamera).toBeTruthy());
    expect(runtimeRef.current.touchCamera!.pad.take()).toEqual({
      yaw: 0,
      pitch: 0,
    });
    await waitFor(() => expect(runtimeRef.current.touchCamera).toBeTruthy());
    const touch = runtimeRef.current.touchCamera!;
    expect(touch.pad).toBe(result.current.touchLook);
    expect(touch.limits).toEqual([-0.6, 0.7]);
    on({ mode: "first" });
    expect(touch.limits).toEqual([-0.5, 0.5]);
    const pad = result.current.touchLook;
    pad.onDown({ pointerId: 1, clientX: 0, clientY: 0 });
    rerender({ active: false, mode: "first", epoch: 0 });
    expect(runtimeRef.current.touchCamera).toBeNull();
    // The finger held when 3D switched off no longer owns the pad.
    pad.onDown({ pointerId: 2, clientX: 0, clientY: 0 });
    pad.onMove({ pointerId: 2, clientX: 10, clientY: 0 });
    expect(pad.take().yaw).toBeGreaterThan(0);
  });

  it("scales the look pad by the latest Kijkgevoeligheid, keeping the same pad", () => {
    const { result, rerender } = renderView3d();
    const pad = result.current.touchLook;
    const dragTenPixels = (pointerId: number): number => {
      pad.onDown({ pointerId, clientX: 0, clientY: 0 });
      pad.onMove({ pointerId, clientX: 10, clientY: 0 });
      pad.onUp({ pointerId, clientX: 10, clientY: 0 });
      return pad.take().yaw;
    };
    const base = dragTenPixels(1);
    rerender({
      active: false,
      mode: "third",
      epoch: 0,
      touchLookSensitivity: 2,
    });
    expect(result.current.touchLook).toBe(pad);
    expect(dragTenPixels(2)).toBeCloseTo(base * 2, 6);
  });

  it("falls back to 2D with a toast but no Sentry error on a device without WebGL2", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockCreateView3d.mockImplementation(() => {
      throw new WebGl2UnavailableError();
    });
    const { result, runtimeRef, onFallback, on } = renderView3d();
    on();
    await waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: "arena", level: "warning" }),
    );
    expect(result.current.notice).toBe(VIEW3D_FAILED_TEXT);
    expect(runtimeRef.current.view3d).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(VIEW3D_NOTICE_MS);
    });
    expect(result.current.notice).toBeNull();
  });

  it("reports any other start failure to Sentry, with the toast and the fallback", async () => {
    const error = new Error("shader compile failed");
    mockCreateView3d.mockImplementation(() => {
      throw error;
    });
    const { result, onFallback, on } = renderView3d();
    on();
    await waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { area: "arena", kind: "render3d" },
    });
    expect(result.current.notice).toBe(VIEW3D_FAILED_TEXT);
  });

  it("frees a started view when mouse-look fails to start after it", async () => {
    const handle = fakeHandle();
    mockCreateView3d.mockReturnValue(handle);
    const error = new Error("no pitch limits");
    mockPitchLimitsFor.mockImplementationOnce(() => {
      throw error;
    });
    const { runtimeRef, onFallback, on } = renderView3d();
    on();
    await waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(runtimeRef.current.view3d).toBeUndefined();
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { area: "arena", kind: "render3d" },
    });
  });

  it("takes a view whose frame throws off the runtime, reporting and falling back once", async () => {
    const handle = fakeHandle();
    const error = new Error("context lost");
    handle.render.mockImplementation(() => {
      throw error;
    });
    mockCreateView3d.mockReturnValue(handle);
    const { runtimeRef, onFallback, on } = renderView3d();
    on();
    const runtime = runtimeRef.current;
    await waitFor(() => expect(runtime.view3d).toBeTruthy());
    const view = runtime.view3d!;
    const overlay = {} as CanvasRenderingContext2D;
    act(() => {
      view.render({} as View3dFrame, overlay);
      view.render({} as View3dFrame, overlay);
    });
    expect(handle.render).toHaveBeenCalledTimes(1);
    expect(runtime.view3d).toBeNull();
    expect(runtime.look).toBeNull();
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { area: "arena", kind: "render3d" },
    });
  });

  it("never attaches a view switched off before the module arrived", async () => {
    mockCreateView3d.mockReturnValue(fakeHandle());
    const { rerender, runtimeRef, layer, on } = renderView3d();
    on();
    rerender({ active: false, mode: "third", epoch: 0 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCreateView3d).not.toHaveBeenCalled();
    expect(runtimeRef.current.view3d).toBeUndefined();
    expect(layer.children).toHaveLength(0);
  });

  it("follows the pointer lock, pauses when the player lets go, and not when it switches off", async () => {
    mockCreateView3d.mockReturnValue(fakeHandle());
    const { result, rerender, runtimeRef, hud, onPause, on } = renderView3d();
    on();
    await waitFor(() => expect(runtimeRef.current.look).toBeTruthy());
    expect(result.current.locked).toBe(false);
    stubPointerLock(hud);
    act(() => {
      document.dispatchEvent(new Event("pointerlockchange"));
    });
    expect(result.current.locked).toBe(true);
    stubPointerLock(null);
    act(() => {
      document.dispatchEvent(new Event("pointerlockchange"));
    });
    expect(onPause).toHaveBeenCalledTimes(1);
    stubPointerLock(hud);
    act(() => {
      document.dispatchEvent(new Event("pointerlockchange"));
    });
    rerender({ active: false, mode: "third", epoch: 0 });
    expect(document.exitPointerLock).toHaveBeenCalledTimes(1);
    stubPointerLock(null);
    act(() => {
      document.dispatchEvent(new Event("pointerlockchange"));
    });
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(result.current.locked).toBe(false);
  });

  it("releases the lock for a modal without pausing, and keeps release stable across renders", async () => {
    mockCreateView3d.mockReturnValue(fakeHandle());
    const { result, runtimeRef, hud, onPause, on } = renderView3d();
    const release = result.current.release;
    // In 2D there is nothing to let go of.
    release();
    expect(document.exitPointerLock).not.toHaveBeenCalled();
    on();
    await waitFor(() => expect(runtimeRef.current.look).toBeTruthy());
    stubPointerLock(hud);
    act(() => {
      document.dispatchEvent(new Event("pointerlockchange"));
    });
    expect(result.current.release).toBe(release);
    act(() => result.current.release());
    expect(document.exitPointerLock).toHaveBeenCalledTimes(1);
    stubPointerLock(null);
    act(() => {
      document.dispatchEvent(new Event("pointerlockchange"));
    });
    expect(result.current.locked).toBe(false);
    expect(onPause).not.toHaveBeenCalled();
  });

  it("reports the lock-free fallback when the browser refuses the lock", async () => {
    mockCreateView3d.mockReturnValue(fakeHandle());
    const { result, runtimeRef, hud, on } = renderView3d();
    hud.requestPointerLock = vi.fn(() =>
      Promise.reject(new DOMException("no", "WrongDocumentError")),
    );
    on();
    await waitFor(() => expect(runtimeRef.current.look).toBeTruthy());
    act(() => {
      hud.dispatchEvent(
        new PointerEvent("pointerdown", { pointerType: "mouse", button: 0 }),
      );
    });
    await waitFor(() => expect(result.current.lockFree).toBe(true));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});

describe("mountView3d", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("still reports a module that fails after the view was switched off, without a toast", async () => {
    const error = new Error("render3d threw while evaluating");
    const layer = document.createElement("div");
    const onFailure = vi.fn();
    const onFallback = vi.fn();
    const stop = mountView3d({
      layer,
      hud: document.createElement("canvas"),
      runtimeRef: { current: fakeRuntime() },
      modeRef: { current: "third" },
      attachedRef: { current: null },
      callbacks: { onFallback, onPause: vi.fn(), onLockChange: vi.fn() },
      onFailure,
      load: () => Promise.reject(error),
    });
    expect(layer.children).toHaveLength(1);
    stop();
    expect(layer.children).toHaveLength(0);
    await waitFor(() =>
      expect(Sentry.captureException).toHaveBeenCalledWith(error, {
        tags: { area: "arena", kind: "render3d" },
      }),
    );
    expect(onFailure).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });
});

describe("useReleaseLockWhile", () => {
  it("releases each time something modal opens, not while it stays open or closes", () => {
    const release = vi.fn();
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useReleaseLockWhile(open, release),
      { initialProps: { open: false } },
    );
    expect(release).not.toHaveBeenCalled();
    rerender({ open: true });
    rerender({ open: true });
    expect(release).toHaveBeenCalledTimes(1);
    rerender({ open: false });
    rerender({ open: true });
    expect(release).toHaveBeenCalledTimes(2);
  });
});

describe("reportView3dFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    Object.assign(new Error("Failed to load chunk /_next/static/chunks/x.js"), {
      name: "ChunkLoadError",
    }),
    new TypeError("Failed to fetch dynamically imported module: /x.js"),
    new TypeError("Importing a module script failed."),
  ])(
    "leaves a breadcrumb, not an issue, for a 3D chunk that failed to download: %s",
    (error) => {
      reportView3dFailure(error);
      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "arena",
          level: "warning",
          message: "3D view chunk failed to download; staying in 2D",
        }),
      );
    },
  );

  it("reports anything else as a render3d error", () => {
    const error = new Error("shader compile failed");
    reportView3dFailure(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { area: "arena", kind: "render3d" },
    });
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });
});
