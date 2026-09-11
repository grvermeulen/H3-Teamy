import { describe, expect, it } from "vitest";
import {
  PERSON_SPRITE_SCALE,
  WALK_ANIMATION_MIN_SPEED_MPS,
  WALK_FRAME_TICKS,
  drawHeldItem,
  drawPersonStrip,
  walkFrameAt,
} from "./drawPersonSprite";
import type { PersonSprite, PropSprite } from "./sprites";
import { createFakeContext } from "./testing/fakeContext";

describe("walkFrameAt", () => {
  it("rests on the first frame while standing and below the walking speed", () => {
    expect(walkFrameAt(0, 40, 8)).toBe(0);
    expect(walkFrameAt(WALK_ANIMATION_MIN_SPEED_MPS / 2, 40, 8)).toBe(0);
  });

  it("steps one frame every few ticks from the walking speed up, wrapping round the strip", () => {
    expect(walkFrameAt(WALK_ANIMATION_MIN_SPEED_MPS, 0, 8)).toBe(0);
    expect(walkFrameAt(1.5, WALK_FRAME_TICKS, 8)).toBe(1);
    expect(walkFrameAt(1.5, WALK_FRAME_TICKS * 2 - 1, 8)).toBe(1);
    expect(walkFrameAt(1.5, WALK_FRAME_TICKS * 7, 8)).toBe(7);
    expect(walkFrameAt(1.5, WALK_FRAME_TICKS * 8, 8)).toBe(0);
    expect(walkFrameAt(1.5, WALK_FRAME_TICKS * 9, 8)).toBe(1);
  });

  it("holds a still on its only frame however fast it moves", () => {
    expect(walkFrameAt(3, WALK_FRAME_TICKS * 5, 1)).toBe(0);
    expect(walkFrameAt(3, WALK_FRAME_TICKS * 5, 0)).toBe(0);
  });
});

describe("drawPersonStrip", () => {
  const sprite: PersonSprite = {
    image: document.createElement("canvas"),
    pixelSize: 51,
    frames: 8,
  };

  it("cuts the frame's cell from the strip and draws it over the scaled circle, turned to the facing", () => {
    const context = createFakeContext();
    drawPersonStrip(context, sprite, 10, 20, 5, 0, 3);
    const half = 5 * PERSON_SPRITE_SCALE;
    expect(context.calls).toEqual([
      "save()",
      "translate(10,20)",
      "rotate(-1.57)",
      `drawImage(${String(sprite.image)},153,0,51,51,${-half},${-half},${half * 2},${half * 2})`,
      "restore()",
    ]);
  });

  it("turns with the facing and starts the first frame at the strip's left edge", () => {
    const context = createFakeContext();
    drawPersonStrip(context, sprite, 0, 0, 5, Math.PI / 2, 0);
    expect(context.calls).toContain("rotate(0)");
    expect(
      context.calls.some((call) =>
        call.startsWith(`drawImage(${String(sprite.image)},0,0,51,51,`),
      ),
    ).toBe(true);
  });
});

describe("drawHeldItem", () => {
  const rifle: PropSprite = {
    image: document.createElement("canvas"),
    lengthMetres: 1.1,
    widthMetres: 0.22,
  };

  it("lays the item along the facing with its grip at the right hand, scaled as the figure is", () => {
    const context = createFakeContext();
    // A radius of 4 px for a 0.4 m person: 10 px per metre.
    drawHeldItem(context, rifle, 10, 20, 4, Math.PI / 2);
    expect(context.calls).toEqual([
      "save()",
      "translate(10,20)",
      "rotate(1.57)",
      // Forward 1.5 px less 30 % of 11 px of grip, right 2.2 px less half the width.
      `drawImage(${String(rifle.image)},-1.8,1.1,11,2.2)`,
      "restore()",
    ]);
  });
});
