import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHASE_IDLE_S } from "@/lib/cityArena/input/cameraYaw";
import type { MouseLook } from "@/lib/cityArena/input/mouseLook";
import { INITIAL_FEEDBACK } from "@/lib/cityArena/render/feedback";
import type { Scene } from "@/lib/cityArena/render/renderScene";
import { createFakeContext } from "@/lib/cityArena/render/testing/fakeContext";
import type { View3dFrame } from "@/lib/cityArena/render3d";
import { createInput, type StructureState } from "@/lib/cityArena/sim/types";
import type { Runtime } from "../arenaRuntime";
import {
  VIEW3D_POPULATION_HALF_M,
  input3d,
  paint3d,
  populationRect3d,
  view3dRuntime,
  type Runtime3d,
} from "./frame3d";

/** A mouse-look stand-in whose next mouse turn the test sets. */
function fakeLook(yaw = 0): MouseLook & { turn(delta: number): void } {
  let current = yaw;
  let pending = 0;
  return {
    yaw: () => current,
    pitch: () => 0.2,
    locked: () => true,
    setYaw: (value) => {
      current = value;
    },
    setPitchLimits: vi.fn(),
    takeYawDelta: () => {
      const delta = pending;
      pending = 0;
      return delta;
    },
    turn(delta) {
      pending += delta;
      current += delta;
    },
    detach: vi.fn(),
  };
}

/** A 3D runtime around player 0, driving car 7 when `driving`. */
function runtime3d(
  look = fakeLook(),
  driving = false,
): Runtime3d & { view3d: { render: ReturnType<typeof vi.fn> } } {
  return {
    netplay: { kind: "offline", playerId: 0 },
    state: {
      players: [
        { id: 0, x: 0, y: 0, facing: 0, vehicleId: driving ? 7 : null },
      ],
      vehicles: [{ id: 7, x: 0, y: 0, heading: 0 }],
    },
    view3d: { render: vi.fn(), dispose: vi.fn() },
    look,
    camera3d: "third",
    quality: "high",
    renderScale: 1,
    diedAtMs: null,
    feedback: INITIAL_FEEDBACK,
  } as unknown as Runtime3d & { view3d: { render: ReturnType<typeof vi.fn> } };
}

describe("view3dRuntime", () => {
  it("is the runtime only with a view and mouse-look attached and the screen not shared", () => {
    const runtime = runtime3d();
    expect(view3dRuntime(runtime)).toBe(runtime);
    expect(view3dRuntime({ ...runtime, look: null } as Runtime)).toBeNull();
    expect(view3dRuntime({ ...runtime, view3d: null } as Runtime)).toBeNull();
    expect(
      view3dRuntime({
        ...runtime,
        sharedScreen: [{ clientId: "a", name: "A" }],
      } as Runtime),
    ).toBeNull();
  });
});

describe("populationRect3d", () => {
  it("keeps the simulation's out-of-sight rect 80 m each way around the player", () => {
    expect(VIEW3D_POPULATION_HALF_M).toBe(80);
    expect(populationRect3d({ x: 100, y: -20 })).toEqual({
      minX: 20,
      minY: -100,
      maxX: 180,
      maxY: 60,
    });
  });
});

describe("input3d", () => {
  it("aims along the camera and walks W along it", () => {
    const runtime = runtime3d(fakeLook(Math.PI / 2));
    const input = input3d(runtime, createInput({ move: [0, -1] }), 1 / 60);
    expect(input.aim).toBeCloseTo(Math.PI / 2);
    expect(runtime.aim3d).toBeCloseTo(Math.PI / 2);
    expect(input.move[0]).toBeCloseTo(0);
    expect(input.move[1]).toBeCloseTo(1);
  });

  it("eases the chase camera behind the car once the mouse has rested for 1.2 s", () => {
    const look = fakeLook(1);
    const runtime = runtime3d(look, true);
    look.turn(0.2);
    input3d(runtime, createInput({}), 0.1);
    expect(look.yaw()).toBeCloseTo(1.2);
    for (let second = 0; second < CHASE_IDLE_S; second += 0.1)
      input3d(runtime, createInput({}), 0.1);
    const before = look.yaw();
    input3d(runtime, createInput({}), 0.1);
    expect(look.yaw()).toBeLessThan(before);
  });

  it("keeps tank steering for a keyboard in a car", () => {
    const runtime = runtime3d(fakeLook(Math.PI), true);
    const input = input3d(runtime, createInput({ move: [1, -1] }), 1 / 60);
    expect(input.move).toEqual([1, -1]);
  });

  it("reads an aim stick relative to the camera and turns the camera toward it", () => {
    const look = fakeLook(0);
    const runtime = runtime3d(look);
    const input = input3d(runtime, createInput({ aim: 0 }), 0.1);
    // Stick right while the camera faces east: aim south, and the camera starts to turn.
    expect(input.aim).toBeCloseTo(Math.PI / 2);
    expect(runtime.aim3d).toBeCloseTo(Math.PI / 2);
    expect(look.yaw()).toBeGreaterThan(0);
    expect(look.yaw()).toBeLessThan(Math.PI / 2);
  });

  it("turns the camera toward a lone touch stick's walk, so touch players can look around", () => {
    const look = fakeLook(0);
    const runtime = runtime3d(look);
    input3d(runtime, createInput({ move: [1, 0], moveIsAnalog: true }), 0.1);
    expect(look.yaw()).toBeGreaterThan(0);
    // The shot still goes along the camera, not along the walk.
    expect(runtime.aim3d).toBe(0);
  });
});

describe("paint3d", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears the 2D canvas and hands the 3D view the blended scene, the look and the clock", () => {
    const context = createFakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    const runtime = runtime3d(fakeLook(0.4));
    runtime.diedAtMs = 1000;
    runtime.aim3d = 1.9;
    const scene = { world: { tiles: [] } } as unknown as Scene;
    const rect = { width: 800, height: 600 } as DOMRect;
    const stats = paint3d(
      document.createElement("canvas"),
      rect,
      runtime,
      scene,
      3500,
      0.016,
    );
    expect(stats.missing).toBe(0);
    expect(context.calls[1]).toBe("clearRect(0,0,800,600)");
    const [frame, overlay] = runtime.view3d.render.mock.calls[0] as [
      View3dFrame,
      unknown,
    ];
    expect(overlay).toBe(context);
    expect(frame).toMatchObject({
      scene,
      yaw: 0.4,
      pitch: 0.2,
      aim: 1.9,
      mode: "third",
      quality: "high",
      deadSeconds: 2.5,
      size: { width: 800, height: 600 },
    });
  });

  it("hands the 3D view the simulation's structures, and an intact city while it has none", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      createFakeContext() as unknown as CanvasRenderingContext2D,
    );
    const runtime = runtime3d();
    const scene = { world: { tiles: [] } } as unknown as Scene;
    const rect = { width: 800, height: 600 } as DOMRect;
    const paint = (): View3dFrame => {
      paint3d(document.createElement("canvas"), rect, runtime, scene, 0, 0);
      return runtime.view3d.render.mock.calls.at(-1)![0] as View3dFrame;
    };
    expect(paint().structures).toEqual([]);
    const structures: StructureState[] = [
      {
        id: 4,
        damage: 120,
        destroyedAtTick: 9,
        lastHitTick: 9,
        x: 0,
        y: 0,
        radius: 0,
      },
    ];
    runtime.state = { ...runtime.state, structures };
    expect(paint().structures).toBe(structures);
  });
});
