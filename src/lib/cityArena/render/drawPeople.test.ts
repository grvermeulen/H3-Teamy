import { describe, expect, it } from "vitest";
import { createCamera } from "./camera";
import { drawPeople } from "./drawPeople";
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
