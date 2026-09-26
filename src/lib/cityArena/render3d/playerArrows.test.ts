import { PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { createFakeContext } from "../render/testing/fakeContext";
import { createArenaPlayer } from "../sim/roster";
import type { ArenaPlayerState } from "../sim/types";
import {
  ARROW_EDGE_MARGIN_PX,
  drawPlayerArrows,
  edgeArrow,
  type EdgeArrow,
} from "./playerArrows";
import { MARKER_RANGE_M, markerCss } from "./playerMarkers3d";

const SIZE = { width: 1600, height: 900 };
const LENS = { fov: 60, aspect: SIZE.width / SIZE.height };

function arrow(): EdgeArrow {
  return { x: 0, y: 0, angle: 0 };
}

function player(
  id: number,
  x: number,
  y: number,
  extra: Partial<ArenaPlayerState> = {},
): ArenaPlayerState {
  return { ...createArenaPlayer([x, y], 0), id, ...extra };
}

/** A camera at the world origin, 2 m up, looking east along +x. */
function eastCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(LENS.fov, LENS.aspect, 0.1, 1000);
  camera.position.set(0, 2, 0);
  camera.lookAt(10, 2, 0);
  camera.updateMatrixWorld();
  return camera;
}

describe("edgeArrow", () => {
  it("is nothing for a point on screen", () => {
    expect(edgeArrow({ x: 1, y: 0, z: -20 }, LENS, SIZE, arrow())).toBeNull();
  });

  it("pins a point off the right of the screen to the right edge, pointing right", () => {
    const found = edgeArrow({ x: 40, y: 0, z: -10 }, LENS, SIZE, arrow())!;

    expect(found.x).toBeCloseTo(SIZE.width - ARROW_EDGE_MARGIN_PX);
    expect(found.y).toBeCloseTo(SIZE.height / 2);
    expect(found.angle).toBeCloseTo(0);
  });

  it("points along the true screen direction, keeping the margin on every edge", () => {
    const found = edgeArrow({ x: -30, y: 30, z: -5 }, LENS, SIZE, arrow())!;

    expect(found.angle).toBeCloseTo(Math.atan2(-30, -30));
    expect(Math.min(found.x, found.y)).toBeCloseTo(ARROW_EDGE_MARGIN_PX);
    expect(found.x).toBeGreaterThanOrEqual(ARROW_EDGE_MARGIN_PX - 1e-9);
  });

  it("turns a point behind the camera to the side it lies on", () => {
    const behindLeft = edgeArrow({ x: -3, y: -1, z: 10 }, LENS, SIZE, arrow())!;
    const straightBehind = edgeArrow(
      { x: 0, y: 0, z: 10 },
      LENS,
      SIZE,
      arrow(),
    )!;

    expect(behindLeft.x).toBeLessThan(SIZE.width / 2);
    expect(straightBehind.y).toBeCloseTo(SIZE.height - ARROW_EDGE_MARGIN_PX);
    expect(straightBehind.angle).toBeCloseTo(Math.PI / 2);
  });

  it("writes into the arrow it is given", () => {
    const out = arrow();
    expect(edgeArrow({ x: 40, y: 0, z: -10 }, LENS, SIZE, out)).toBe(out);
  });
});

describe("drawPlayerArrows", () => {
  it("points at a friend off screen within 300 m in their colour, and at no one else", () => {
    const context = createFakeContext();

    drawPlayerArrows(context, eastCamera(), {
      origin: { x: 0, y: 0 },
      size: SIZE,
      players: [
        player(1, 0, 0),
        player(7, 0, -60),
        player(8, 60, 0),
        player(9, 0, 60, { diedAtTick: 3 }),
        player(10, -(MARKER_RANGE_M + 5), 0),
      ],
      localPlayerId: 1,
    });

    const fills = context.calls.filter((call) => call.startsWith("fill("));
    expect(fills).toEqual([`fill(${markerCss(7)})`]);
  });

  it("draws the arrow at the screen edge on the friend's side", () => {
    const context = createFakeContext();

    drawPlayerArrows(context, eastCamera(), {
      origin: { x: 0, y: 0 },
      size: SIZE,
      players: [player(1, 0, 0), player(7, 0, 60)],
      localPlayerId: 1,
    });

    const [translate] = context.calls.filter((call) =>
      call.startsWith("translate("),
    );
    const [x] = translate!
      .slice("translate(".length, -1)
      .split(",")
      .map(Number);
    expect(x).toBeCloseTo(SIZE.width - ARROW_EDGE_MARGIN_PX, 1);
  });
});
