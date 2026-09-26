import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { createFakeContext } from "../render/testing/fakeContext";
import { applyRigPose, rigPose, type RigInput } from "./cameraRig";
import {
  CROSSHAIR_EDGE_MARGIN_PX,
  clampToScreen,
  crosshairScreen,
  drawOverlay3d,
} from "./overlay3d";

const SIZE = { width: 1280, height: 720 };

/** A camera placed by the rig for a player at `(10, 20)` looking along `yaw`. */
function placedCamera(overrides: Partial<RigInput> = {}): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, SIZE.width / SIZE.height, 0.1, 2000);
  applyRigPose(
    camera,
    rigPose({
      mode: "third",
      yaw: 0.8,
      pitch: 0,
      target: { x: 10, y: 20 },
      driving: null,
      dead: false,
      deadSeconds: 0,
      dt: 1 / 60,
      ...overrides,
    }),
  );
  camera.updateMatrixWorld();
  return camera;
}

describe("crosshairScreen", () => {
  it("lands on the screen's centre column at pitch 0 in both camera modes", () => {
    for (const mode of ["third", "first"] as const) {
      const point = crosshairScreen(
        placedCamera({ mode }),
        { x: 10, y: 20 },
        0.8,
        SIZE,
      );
      expect(point).not.toBeNull();
      expect(point![0]).toBeCloseTo(SIZE.width / 2, 0);
    }
  });

  it("sits in the centre in third person, where the view converges on the shot line", () => {
    const point = crosshairScreen(placedCamera(), { x: 10, y: 20 }, 0.8, SIZE);
    expect(point![1]).toBeCloseTo(SIZE.height / 2, 0);
  });

  it("drops below the centre when the player looks up: the shot stays flat", () => {
    const point = crosshairScreen(
      placedCamera({ pitch: 0.5 }),
      { x: 10, y: 20 },
      0.8,
      SIZE,
    );
    expect(point![1]).toBeGreaterThan(SIZE.height / 2 + 50);
  });

  it("is null when the shot line lies behind the camera", () => {
    const point = crosshairScreen(
      placedCamera({ mode: "first" }),
      { x: 10, y: 20 },
      0.8 + Math.PI,
      SIZE,
    );
    expect(point).toBeNull();
  });
});

describe("drawOverlay3d", () => {
  it("draws the crosshair while alive and nothing once dead", () => {
    const camera = placedCamera();
    const alive = createFakeContext();
    drawOverlay3d(alive as unknown as CanvasRenderingContext2D, camera, {
      origin: { x: 10, y: 20 },
      aim: 0.8,
      size: SIZE,
      dead: false,
    });
    expect(alive.calls.some((call) => call.startsWith("stroke("))).toBe(true);
    const dead = createFakeContext();
    drawOverlay3d(dead as unknown as CanvasRenderingContext2D, camera, {
      origin: { x: 10, y: 20 },
      aim: 0.8,
      size: SIZE,
      dead: true,
    });
    expect(dead.calls).toEqual([]);
  });
});

describe("clampToScreen", () => {
  it("keeps the crosshair a margin inside every edge", () => {
    const margin = CROSSHAIR_EDGE_MARGIN_PX;
    expect(clampToScreen([640, 360], SIZE)).toEqual([640, 360]);
    expect(clampToScreen([-50, -900], SIZE)).toEqual([margin, margin]);
    expect(clampToScreen([5000, 4000], SIZE)).toEqual([
      SIZE.width - margin,
      SIZE.height - margin,
    ]);
  });

  it("draws the crosshair at the top edge when looking far down pushes it off screen", () => {
    const camera = placedCamera({ pitch: -0.6 });
    const projected = crosshairScreen(camera, { x: 10, y: 20 }, 0.8, SIZE)!;
    expect(projected[1]).toBeLessThan(0);
    const context = createFakeContext();
    drawOverlay3d(context, camera, {
      origin: { x: 10, y: 20 },
      aim: 0.8,
      size: SIZE,
      dead: false,
    });
    const arc = context.calls.find((call) => call.startsWith("arc("))!;
    expect(arc.split(",")[1]).toBe(String(CROSSHAIR_EDGE_MARGIN_PX));
  });

  it("follows the aim sent to the simulation, not the camera, for a stick aim", () => {
    const camera = placedCamera({ mode: "first" });
    const draw = (aim: number): string => {
      const context = createFakeContext();
      drawOverlay3d(context, camera, {
        origin: { x: 10, y: 20 },
        aim,
        size: SIZE,
        dead: false,
      });
      return context.calls.find((call) => call.startsWith("arc("))!;
    };
    expect(draw(0.8 + 0.3)).not.toBe(draw(0.8));
  });
});
