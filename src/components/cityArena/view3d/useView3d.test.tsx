import * as Sentry from "@sentry/nextjs";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { View3dFrame, View3dHandle } from "@/lib/cityArena/render3d";
import type { Runtime } from "../arenaRuntime";
import { VIEW3D_FAILED_TEXT, VIEW3D_NOTICE_MS, useView3d } from "./useView3d";

// Hoisted so the module factory below can hand it out (Vitest hoists `vi.mock`).
const mockCreateView3d = vi.hoisted(() => vi.fn());

vi.mock("@/lib/cityArena/render3d", () => ({
  createView3d: mockCreateView3d,
  pitchLimitsFor: (mode: "third" | "first") =>
    mode === "third" ? [-0.6, 0.7] : [-0.5, 0.5],
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

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

/** Renders the hook, switched off, around a runtime whose player faces `facing`. */
function renderView3d(facing = 1.1) {
  const runtime = {
    state: {
      players: [{ id: 0, x: 0, y: 0, facing, vehicleId: null }],
      vehicles: [],
    },
    netplay: { kind: "offline", playerId: 0 },
    sound: { unlock: vi.fn() },
  } as unknown as Runtime;
  const runtimeRef = { current: runtime };
  const hud = document.createElement("canvas");
  hud.requestPointerLock = vi.fn(() => Promise.resolve());
  const hudCanvasRef = { current: hud };
  const onFallback = vi.fn();
  const hook = renderHook(
    (props: { active: boolean; mode: "third" | "first" }) =>
      useView3d({
        active: props.active,
        epoch: 0,
        mode: props.mode,
        runtimeRef,
        hudCanvasRef,
        onFallback,
      }),
    { initialProps: { active: false, mode: "third" } },
  );
  const gl = document.createElement("canvas");
  hook.result.current.canvasRef.current = gl;
  return { ...hook, runtime, hud, gl, onFallback };
}

describe("useView3d", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPointerLock(null);
    document.exitPointerLock = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("attaches the view and mouse-look to the runtime, behind the player, and frees both in 2D", async () => {
    const handle = fakeHandle();
    mockCreateView3d.mockReturnValue(handle);
    const { rerender, runtime, gl } = renderView3d(1.1);
    rerender({ active: true, mode: "third" });
    await waitFor(() => expect(runtime.view3d).toBeTruthy());
    expect(mockCreateView3d).toHaveBeenCalledWith(gl);
    expect(runtime.look!.yaw()).toBeCloseTo(1.1);
    rerender({ active: false, mode: "third" });
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(runtime.view3d).toBeNull();
    expect(runtime.look).toBeNull();
  });

  it("narrows the pitch range when the camera moves behind the eyes", async () => {
    mockCreateView3d.mockReturnValue(fakeHandle());
    const { rerender, runtime, hud } = renderView3d();
    rerender({ active: true, mode: "third" });
    await waitFor(() => expect(runtime.look).toBeTruthy());
    stubPointerLock(hud);
    hud.dispatchEvent(new MouseEvent("pointermove", { movementY: -5000 }));
    expect(runtime.look!.pitch()).toBeCloseTo(0.7);
    rerender({ active: true, mode: "first" });
    expect(runtime.look!.pitch()).toBeCloseTo(0.5);
    rerender({ active: false, mode: "first" });
    expect(document.exitPointerLock).toHaveBeenCalledTimes(1);
  });

  it("falls back to 2D with a toast and a Sentry report when WebGL is unavailable", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const error = new Error("WebGL2 is not available on this device");
    mockCreateView3d.mockImplementation(() => {
      throw error;
    });
    const { rerender, result, runtime, onFallback } = renderView3d();
    rerender({ active: true, mode: "third" });
    await waitFor(() => expect(onFallback).toHaveBeenCalledTimes(1));
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { area: "arena", kind: "render3d" },
    });
    expect(result.current.notice).toBe(VIEW3D_FAILED_TEXT);
    expect(runtime.view3d).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(VIEW3D_NOTICE_MS);
    });
    expect(result.current.notice).toBeNull();
  });

  it("takes a view whose frame throws off the runtime, reporting and falling back once", async () => {
    const handle = fakeHandle();
    const error = new Error("context lost");
    handle.render.mockImplementation(() => {
      throw error;
    });
    mockCreateView3d.mockReturnValue(handle);
    const { rerender, runtime, onFallback } = renderView3d();
    rerender({ active: true, mode: "third" });
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
    const { rerender, runtime } = renderView3d();
    rerender({ active: true, mode: "third" });
    rerender({ active: false, mode: "third" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockCreateView3d).not.toHaveBeenCalled();
    expect(runtime.view3d).toBeUndefined();
  });

  it("reports whether mouse-look holds the pointer", () => {
    const { result, hud } = renderView3d();
    expect(result.current.locked).toBe(false);
    stubPointerLock(hud);
    act(() => {
      document.dispatchEvent(new Event("pointerlockchange"));
    });
    expect(result.current.locked).toBe(true);
  });
});
