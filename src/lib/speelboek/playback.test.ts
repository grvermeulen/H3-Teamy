import { describe, expect, it } from "vitest";
import type { DrillStep } from "../schemas/speelboek";
import { playbackFrame } from "./playback";

function step(
  players: DrillStep["frame"]["players"],
  arrows: DrillStep["frame"]["arrows"] = [],
  ballPlayerId?: string,
): DrillStep {
  return {
    title: "Stap",
    text: "Uitleg",
    roles: [],
    frame: { attackColor: "WHITE", players, arrows, ballPlayerId },
  };
}

const start = step(
  [
    { id: "p1", team: "OFF", x: 0, y: 0 },
    { id: "d1", team: "DEF", x: 40, y: 40 },
  ],
  [
    { kind: "MOVE", playerId: "p1", to: [100, 0], via: [50, 80] },
    { kind: "PASS", playerId: "p1", to: [40, 40] },
  ],
  "p1",
);
const next = step(
  [
    { id: "p1", team: "OFF", x: 100, y: 0 },
    { id: "d1", team: "DEF", x: 10, y: 20 },
  ],
  [],
  "d1",
);

describe("playbackFrame", () => {
  it("starts on this step and arrives on the next step's positions", () => {
    expect(playbackFrame([start, next], 0, 0).positions.p1).toEqual({
      x: 0,
      y: 0,
    });
    expect(playbackFrame([start, next], 0, 1).positions).toEqual({
      p1: { x: 100, y: 0 },
      d1: { x: 10, y: 20 },
    });
  });

  it("follows the swim curve instead of a straight line", () => {
    const mid = playbackFrame([start, next], 0, 0.5).positions.p1;
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBeCloseTo(40);
  });

  it("slides a player who only changes position, and carries the ball along a pass", () => {
    const played = playbackFrame([start, next], 0, 0.5);
    expect(played.positions.d1).toEqual({ x: 25, y: 30 });
    expect(played.ballAt).toEqual({ x: 5, y: 10 });
    expect(played.frame.arrows).toHaveLength(2);
  });
});
