import { describe, expect, it } from "vitest";
import { createCamera } from "./camera";
import { drawPeople } from "./drawPeople";
import type { PersonSprite } from "./sprites";
import { COP_FILL, PED_FILL } from "./palette";
import { createFakeContext } from "./testing/fakeContext";

const viewport = { width: 100, height: 100 };
const camera = createCamera([0, 0], 4);

describe("drawPeople", () => {
  it("draws living pedestrians and cops with facing and health cues", () => {
    const context = createFakeContext();
    drawPeople(
      context,
      camera,
      viewport,
      [
        {
          id: 1,
          x: 0,
          y: 0,
          facing: 0,
          health: 20,
          mode: "walk",
          modeUntilTick: 0,
          rail: null,
          fleeX: 0,
          fleeY: 0,
        },
      ],
      [
        {
          id: 2,
          x: 1,
          y: 0,
          facing: Math.PI,
          health: 60,
          weapon: "pistol",
          path: [],
          repathTick: 0,
          nextShotTick: 0,
          diedAtTick: null,
        },
      ],
    );
    expect(context.calls).toContain(`fill(${PED_FILL})`);
    expect(context.calls).toContain(`fill(${COP_FILL})`);
    expect(context.calls.some((call) => call.startsWith("lineTo("))).toBe(true);
  });

  it("keeps dead bodies muted and culls people outside the margin", () => {
    const context = createFakeContext();
    drawPeople(
      context,
      camera,
      viewport,
      [
        {
          id: 3,
          x: 100,
          y: 100,
          facing: 0,
          health: 0,
          mode: "dead",
          modeUntilTick: 10,
          rail: null,
          fleeX: 0,
          fleeY: 0,
        },
      ],
      [],
    );
    expect(context.calls).toEqual([]);
  });
});

describe("drawPeople with art", () => {
  const strip: PersonSprite = {
    image: document.createElement("canvas"),
    pixelSize: 51,
    frames: 8,
  };

  it("draws a pedestrian's look and the cop's uniform over their circles, facing ticks gone", () => {
    const context = createFakeContext();
    drawPeople(
      context,
      camera,
      viewport,
      [
        {
          id: 1,
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
      [
        {
          id: 2,
          x: 1,
          y: 0,
          facing: Math.PI,
          health: 100,
          weapon: "pistol",
          path: [],
          repathTick: 0,
          nextShotTick: 0,
          diedAtTick: null,
        },
      ],
      // Pedestrian 1 has look index 1, the manifest's `ped2`.
      { ped2: strip, cop: strip },
      12,
    );
    expect(
      context.calls.filter((call) => call.startsWith("drawImage(")),
    ).toHaveLength(2);
    expect(context.calls.some((call) => call.startsWith("lineTo("))).toBe(
      false,
    );
    expect(context.calls).toContain(`fill(${PED_FILL})`);
  });

  it("keeps a body on the flat marker and a look without art on the facing tick", () => {
    const context = createFakeContext();
    drawPeople(
      context,
      camera,
      viewport,
      [
        {
          id: 3,
          x: 0,
          y: 0,
          facing: 0,
          health: 0,
          mode: "dead",
          modeUntilTick: 0,
          rail: null,
          fleeX: 0,
          fleeY: 0,
        },
        {
          id: 4,
          x: 2,
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
      [],
      { ped4: strip },
      0,
    );
    expect(
      context.calls.filter((call) => call.startsWith("drawImage(")),
    ).toHaveLength(0);
    expect(context.calls.some((call) => call.startsWith("lineTo("))).toBe(true);
  });
});
