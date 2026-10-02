import { PerspectiveCamera } from "three";
import { describe, expect, it, vi } from "vitest";
import { createFakeContext } from "../render/testing/fakeContext";
import { createArenaPlayer } from "../sim/roster";
import { applyRigPose, rigPose, type RigInput } from "./cameraRig";
import { SCOPE_RADIUS_SHARE, SCOPE_SHADE, drawOverlay3d } from "./overlay3d";
import { drawPlayerArrows } from "./playerArrows";
import { markerCss } from "./playerMarkers3d";

// The real arrows, watched: the overlay must hand them its own input, not a copy per frame.
vi.mock("./playerArrows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./playerArrows")>();
  return { ...actual, drawPlayerArrows: vi.fn(actual.drawPlayerArrows) };
});

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

describe("drawOverlay3d", () => {
  it("draws the crosshair at the screen's centre in both modes, however far the view pitches", () => {
    for (const mode of ["third", "first"] as const)
      for (const pitch of [-0.5, 0, 0.5]) {
        const context = createFakeContext();
        drawOverlay3d(context, placedCamera({ mode, pitch }), {
          origin: { x: 10, y: 20 },
          size: SIZE,
          dead: false,
        });
        const arc = context.calls.find((call) => call.startsWith("arc("))!;
        expect(arc.split(",").slice(0, 2)).toEqual(["arc(640", "360"]);
      }
  });

  it("draws the crosshair while alive and nothing once dead", () => {
    const camera = placedCamera();
    const alive = createFakeContext();
    drawOverlay3d(alive, camera, {
      origin: { x: 10, y: 20 },
      size: SIZE,
      dead: false,
    });
    expect(alive.calls.some((call) => call.startsWith("stroke("))).toBe(true);
    const dead = createFakeContext();
    drawOverlay3d(dead, camera, {
      origin: { x: 10, y: 20 },
      size: SIZE,
      dead: true,
    });
    expect(dead.calls).toEqual([]);
  });

  it("points an arrow at a friend behind you while alive, and none once dead", () => {
    const camera = placedCamera();
    const friends = {
      players: [
        { ...createArenaPlayer([10, 20], 0), id: 1 },
        { ...createArenaPlayer([-20, -10], 0), id: 7 },
      ],
      localPlayerId: 1,
    };
    const input = { origin: { x: 10, y: 20 }, size: SIZE, friends };
    const alive = createFakeContext();
    drawOverlay3d(alive, camera, { ...input, dead: false });
    expect(alive.calls).toContain(`fill(${markerCss(7)})`);
    const dead = createFakeContext();
    drawOverlay3d(dead, camera, { ...input, dead: true });
    expect(dead.calls).toEqual([]);
  });

  it("looks through the rifle's scope: a dark surround round a clear circle, a reticle for the crosshair", () => {
    const camera = placedCamera({ mode: "first" });
    const input = { origin: { x: 10, y: 20 }, size: SIZE, dead: false };
    const hip = createFakeContext();
    drawOverlay3d(hip, camera, input);
    const crosshair = hip.calls.find((call) => call.startsWith("arc("))!;
    const scoped = createFakeContext();
    drawOverlay3d(scoped, camera, { ...input, scope: 1 });
    const radius = SIZE.height * SCOPE_RADIUS_SHARE;
    expect(scoped.calls).toContain(`fill(${SCOPE_SHADE})`);
    expect(
      scoped.calls.some((call) => call.startsWith(`arc(640,360,${radius}`)),
    ).toBe(true);
    expect(scoped.calls).not.toContain(crosshair);
    expect(
      scoped.calls.filter((call) => call.startsWith("lineTo(")).length,
    ).toBeGreaterThanOrEqual(8);
  });

  it("fades the scope in with the sights and leaves it off at the hip", () => {
    const camera = placedCamera({ mode: "first" });
    const input = { origin: { x: 10, y: 20 }, size: SIZE, dead: false };
    const half = createFakeContext();
    const alphas: number[] = [];
    const fill = half.fill;
    half.fill = (...args) => {
      alphas.push(half.globalAlpha);
      fill(...args);
    };
    drawOverlay3d(half, camera, { ...input, scope: 0.5 });
    expect(alphas[0]).toBe(0.5);
    const none = createFakeContext();
    drawOverlay3d(none, camera, { ...input, scope: 0 });
    expect(none.calls).not.toContain(`fill(${SCOPE_SHADE})`);
  });

  it("hands the arrows its own input, making no new object per frame", () => {
    const camera = placedCamera();
    const friends = { players: [], localPlayerId: 1 };
    const input = {
      origin: { x: 10, y: 20 },
      size: SIZE,
      dead: false,
      friends,
    };
    vi.mocked(drawPlayerArrows).mockClear();

    drawOverlay3d(createFakeContext(), camera, input);

    expect(vi.mocked(drawPlayerArrows).mock.calls[0]![2]).toBe(input);
  });
});
