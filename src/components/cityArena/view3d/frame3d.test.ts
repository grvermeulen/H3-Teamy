import { PerspectiveCamera } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHASE_IDLE_S } from "@/lib/cityArena/input/cameraYaw";
import type { MouseLook } from "@/lib/cityArena/input/mouseLook";
import { INITIAL_FEEDBACK } from "@/lib/cityArena/render/feedback";
import type { Scene } from "@/lib/cityArena/render/renderScene";
import { createFakeContext } from "@/lib/cityArena/render/testing/fakeContext";
import type { AimPoint, View3dFrame } from "@/lib/cityArena/render3d";
import {
  CHARACTER_RADIUS_M,
  probeAim,
} from "@/lib/cityArena/render3d/aimProbe";
import { applyRigPose, rigPose } from "@/lib/cityArena/render3d/cameraRig";
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
    setZoom: vi.fn(),
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

/** An aim point at `(x, y)` on the ground. */
function aimAt(x: number, y: number): AimPoint {
  return { x, y, height: 0, distance: Math.hypot(x, y), target: "ground" };
}

/**
 * What the crosshair covers over the right shoulder of a player at the origin looking east, with
 * `target` standing in the street: the real rig places the camera, the real probe looks.
 */
function crosshairOver(target: { x: number; y: number }): AimPoint {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 2000);
  applyRigPose(
    camera,
    rigPose({
      mode: "third",
      yaw: 0,
      pitch: 0,
      target: { x: 0, y: 0 },
      driving: null,
      dead: false,
      deadSeconds: 0,
      dt: 1 / 60,
    }),
  );
  const world = {
    characters: [{ ...target, dead: false, self: false }],
    vehicles: [],
    buildings: { visit: () => undefined },
  };
  return probeAim(camera, world, 70, aimAt(0, 0), { x: 0, y: 0 });
}

/** A 3D runtime around player 0, driving car 7 when `driving`. */
function runtime3d(
  look = fakeLook(),
  driving = false,
): Runtime3d & {
  view3d: {
    render: ReturnType<typeof vi.fn>;
    aimPoint: ReturnType<typeof vi.fn<() => AimPoint | null>>;
    lookZoom: ReturnType<typeof vi.fn<() => number>>;
  };
} {
  return {
    netplay: { kind: "offline", playerId: 0 },
    state: {
      players: [
        { id: 0, x: 0, y: 0, facing: 0, vehicleId: driving ? 7 : null },
      ],
      vehicles: [{ id: 7, x: 0, y: 0, heading: 0 }],
    },
    view3d: {
      render: vi.fn(),
      dispose: vi.fn(),
      aimPoint: vi.fn<() => AimPoint | null>(() => null),
      lookZoom: vi.fn(() => 1),
    },
    look,
    camera3d: "third",
    quality: "high",
    renderScale: 1,
    diedAtMs: null,
    feedback: INITIAL_FEEDBACK,
  } as unknown as ReturnType<typeof runtime3d>;
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

  it("shoots at what the crosshair covers over the shoulder, which the camera's yaw would miss", () => {
    const target = { x: 60, y: -0.7 };
    const point = crosshairOver(target);
    expect(point.target).toBe("character");
    const runtime = runtime3d(fakeLook(0));
    runtime.view3d.aimPoint.mockReturnValue(point);

    const input = input3d(runtime, createInput({}), 1 / 60);

    const missBy = (heading: number): number =>
      Math.abs(target.y - Math.tan(heading) * target.x);
    expect(missBy(input.aim!)).toBeLessThan(CHARACTER_RADIUS_M);
    expect(missBy(0)).toBeGreaterThan(CHARACTER_RADIUS_M);
    expect(runtime.aim3d).toBe(input.aim);
  });

  it("aims from the car it drives, not from the seat", () => {
    const runtime = runtime3d(fakeLook(0), true);
    runtime.state.vehicles[0]!.x = 10;
    runtime.view3d.aimPoint.mockReturnValue(aimAt(10, 20));
    const input = input3d(runtime, createInput({}), 1 / 60);
    expect(input.aim).toBeCloseTo(Math.PI / 2);
  });

  it("keeps the camera's yaw while the crosshair covers the player's own feet", () => {
    const runtime = runtime3d(fakeLook(0.3));
    runtime.view3d.aimPoint.mockReturnValue(aimAt(0.2, 0.5));
    expect(input3d(runtime, createInput({}), 1 / 60).aim).toBeCloseTo(0.3);
  });

  it("reads an aim stick relative to the camera and turns the camera toward it", () => {
    const look = fakeLook(0);
    const runtime = runtime3d(look);
    runtime.view3d.aimPoint.mockReturnValue(aimAt(30, -20));
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

  it("raises the view's sights while the input aims down them, and not while a menu has it", () => {
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
    input3d(runtime, createInput({ ads: true }), 1 / 60);
    expect(paint().ads).toBe(true);
    runtime.inputSuspended = true;
    expect(paint().ads).toBe(false);
    runtime.inputSuspended = false;
    input3d(runtime, createInput({}), 1 / 60);
    expect(paint().ads).toBe(false);
  });

  it("slows mouse-look by however much the sights zoomed the view", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      createFakeContext() as unknown as CanvasRenderingContext2D,
    );
    const runtime = runtime3d();
    runtime.view3d.lookZoom.mockReturnValue(0.3);
    const scene = { world: { tiles: [] } } as unknown as Scene;
    const rect = { width: 800, height: 600 } as DOMRect;
    paint3d(document.createElement("canvas"), rect, runtime, scene, 0, 0);
    expect(runtime.look.setZoom).toHaveBeenCalledWith(0.3);
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
