import { describe, expect, it } from "vitest";
import { createArenaPlayer } from "../sim/arena";
import type { BulletState } from "../sim/types";
import { createVehicle } from "../sim/vehicle";
import { createCamera } from "./camera";
import type { LandmarkLookup } from "./drawStatic";
import {
  BULLET_STROKE,
  CROSSHAIR_STROKE,
  MUZZLE_FILL,
  PED_FILL,
  PICKUP_UZI,
  PLAYER_FILL,
  PLAYER_OTHER_FILL,
} from "./palette";
import { renderScene, type Scene } from "./renderScene";
import { createStaticRaster } from "./staticRaster";
import { createFakeContext } from "./testing/fakeContext";

const bullet: BulletState = {
  id: 2,
  ownerId: 0,
  ignoreVehicleId: null,
  x: 2,
  y: 0,
  directionX: 1,
  directionY: 0,
  speedMps: 120,
  rangeLeftM: 10,
  damage: 20,
  weapon: "pistol",
};

function sceneWith(partial: Partial<Scene>): Scene {
  const landmarks: LandmarkLookup = new Map();
  return {
    world: {
      raster: createStaticRaster(() => null),
      tiles: [],
      landmarks,
      loadedTileRects: [],
    },
    zone: null,
    players: [createArenaPlayer([0, 0], 0)],
    localPlayerId: 0,
    peds: [],
    cops: [],
    pickups: [],
    vehicles: [createVehicle(1, "sedan", [5, 0], 0, 0)],
    bullets: [bullet],
    effects: [
      { id: 3, kind: "muzzle", x: 0, y: 0, angle: 0, bornTick: 0, ttlTicks: 2 },
    ],
    tick: 1,
    aimScreen: [30, 20],
    pushIn: 1.05,
    ...partial,
  };
}

const viewport = {
  rect: { x: 10, y: 20, width: 100, height: 50 },
  camera: createCamera([0, 0], 4),
};

describe("renderScene", () => {
  it("clips, pushes in, draws world → cars → bullets → effects → player → crosshair and restores", () => {
    const context = createFakeContext();
    const stats = renderScene(context, viewport, sceneWith({}));
    const calls = context.calls;
    const order = [
      calls.findIndex((call) => call.startsWith("rotate(")),
      calls.indexOf(`stroke(${BULLET_STROKE},2)`),
      calls.indexOf(`fill(${MUZZLE_FILL})`),
      calls.indexOf(`fill(${PLAYER_FILL})`),
      calls.indexOf(`stroke(${CROSSHAIR_STROKE},1.5)`),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    expect(calls[0]).toBe("save()");
    expect(calls).toContain("rect(10,20,100,50)");
    expect(calls).toContain("clip()");
    expect(calls).toContain("scale(1.05,1.05)");
    expect(calls[calls.length - 1]).toBe("restore()");
    expect(stats.missing).toBeGreaterThan(0);
  });

  it("draws every player, your own last and in your own colours", () => {
    const context = createFakeContext();
    const mine = createArenaPlayer([0, 0], 0);
    const theirs = { ...createArenaPlayer([8, 0], 0), id: 4 };
    renderScene(
      context,
      viewport,
      sceneWith({ players: [theirs, mine], localPlayerId: mine.id }),
    );
    const fills = context.calls.filter((call) => call.startsWith("fill("));
    expect(fills).toContain(`fill(${PLAYER_OTHER_FILL})`);
    expect(fills).toContain(`fill(${PLAYER_FILL})`);
    // Yours is painted after theirs, so nobody can stand on top of you.
    expect(fills.lastIndexOf(`fill(${PLAYER_FILL})`)).toBeGreaterThan(
      fills.lastIndexOf(`fill(${PLAYER_OTHER_FILL})`),
    );
  });

  it("hides the player inside a car and skips the push-in at 1", () => {
    const context = createFakeContext();
    const player = { ...createArenaPlayer([5, 0], 0), vehicleId: 1 };
    renderScene(
      context,
      viewport,
      sceneWith({ players: [player], pushIn: 1, aimScreen: null }),
    );
    expect(context.calls).not.toContain(`fill(${PLAYER_FILL})`);
    expect(context.calls.some((call) => call.startsWith("scale("))).toBe(false);
    expect(context.calls).not.toContain(`stroke(${CROSSHAIR_STROKE},1.5)`);
  });

  it("keeps pickups before cars and people before bullets", () => {
    const context = createFakeContext();
    renderScene(
      context,
      viewport,
      sceneWith({
        pickups: [{ id: 4, kind: "uzi", x: 0, y: 0, takenAtTick: null }],
        peds: [
          {
            id: 5,
            x: 0,
            y: 0,
            facing: 0,
            health: 40,
            mode: "walk",
            modeUntilTick: 0,
            rail: null,
            fleeX: 0,
            fleeY: 0,
          },
        ],
      }),
    );
    const order = [
      context.calls.indexOf(`fill(${PICKUP_UZI})`),
      context.calls.findIndex(
        (call, index) =>
          index > context.calls.indexOf(`fill(${PICKUP_UZI})`) &&
          call.startsWith("translate("),
      ),
      context.calls.indexOf(`fill(${PED_FILL})`),
      context.calls.indexOf(`stroke(${BULLET_STROKE},2)`),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });
});
