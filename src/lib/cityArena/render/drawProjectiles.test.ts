import { describe, expect, it } from "vitest";
import type { BulletState } from "../sim/types";
import { createCamera } from "./camera";
import { drawBullets, drawCrosshair, drawEffects } from "./drawProjectiles";
import {
  BULLET_STROKE,
  CROSSHAIR_STROKE,
  EXPLOSION_RING,
  MUZZLE_FILL,
} from "./palette";
import { createFakeContext } from "./testing/fakeContext";

const camera = createCamera([10, 10], 8);
const viewport = { width: 200, height: 100 };
const bullet: BulletState = {
  id: 1,
  ownerId: 0,
  ignoreVehicleId: null,
  x: 12,
  y: 10,
  directionX: 1,
  directionY: 0,
  speedMps: 120,
  rangeLeftM: 10,
  damage: 20,
  weapon: "pistol",
};

describe("drawProjectiles", () => {
  it("draws tracers behind bullets", () => {
    const context = createFakeContext();
    drawBullets(context, camera, viewport, [bullet]);
    expect(context.calls).toContain("moveTo(109.6,50)");
    expect(context.calls).toContain("lineTo(116,50)");
    expect(context.calls).toContain(`stroke(${BULLET_STROKE},2)`);
  });

  it("draws a muzzle flash ahead of the shooter and a growing, fading explosion", () => {
    const context = createFakeContext();
    drawEffects(
      context,
      camera,
      viewport,
      [
        {
          id: 1,
          kind: "muzzle",
          x: 10,
          y: 10,
          angle: 0,
          bornTick: 0,
          ttlTicks: 2,
        },
        {
          id: 2,
          kind: "impact",
          x: 10,
          y: 10,
          angle: 0,
          bornTick: 0,
          ttlTicks: 6,
        },
        {
          id: 3,
          kind: "explosion",
          x: 10,
          y: 10,
          angle: 0,
          bornTick: 0,
          ttlTicks: 18,
        },
      ],
      9,
    );
    expect(context.calls).toContain("arc(104.8,50,2.8,0,6.28,false)");
    expect(context.calls).toContain(`fill(${MUZZLE_FILL})`);
    expect(context.calls).toContain("arc(100,50,12,0,6.28,false)");
    expect(context.calls).toContain(`stroke(${EXPLOSION_RING},3)`);
  });

  it("draws the crosshair at the pointer", () => {
    const context = createFakeContext();
    drawCrosshair(context, [50, 40]);
    expect(context.calls).toContain("arc(50,40,8,0,6.28,false)");
    expect(context.calls).toContain("moveTo(39,40)");
    expect(context.calls).toContain(`stroke(${CROSSHAIR_STROKE},1.5)`);
  });
});
