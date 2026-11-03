import { describe, expect, it } from "vitest";
import { diagramFrameSchema } from "../schemas/speelboek";
import {
  attackerId,
  defenderId,
  KEEPER_ID,
  STANDARD_POSITIONS,
  rosterCapTone,
  STANDARD_ROSTER,
  standardLineup,
} from "./lineup";

describe("standardLineup", () => {
  it("numbers the attack 1 on the right through 5 on the left, 6 in the centre", () => {
    expect(STANDARD_POSITIONS[1].x).toBeGreaterThan(STANDARD_POSITIONS[5].x);
    expect(STANDARD_POSITIONS[1].name).toBe("Vleugel rechts");
    expect(STANDARD_POSITIONS[5].name).toBe("Vleugel links");
    expect(STANDARD_POSITIONS[6].name).toBe("Midvoor");
    expect(STANDARD_POSITIONS[6].y).toBeLessThan(STANDARD_POSITIONS[3].y);
  });

  it("builds a valid 6-v-6 frame with the ball on position 3", () => {
    const frame = standardLineup();
    expect(() => diagramFrameSchema.parse(frame)).not.toThrow();
    expect(frame.players).toHaveLength(13);
    expect(frame.players.filter((p) => p.team === "OFF")).toHaveLength(6);
    expect(frame.players.filter((p) => p.team === "DEF")).toHaveLength(6);
    expect(frame.players.find((p) => p.id === KEEPER_ID)?.team).toBe("GK");
    expect(frame.ballPlayerId).toBe(attackerId(3));
  });

  it("applies overrides by id and removes players", () => {
    const frame = standardLineup(
      [{ id: attackerId(1), team: "OFF", x: 180, y: 40 }],
      [defenderId(4)],
    );
    expect(frame.players.find((p) => p.id === "p1")).toMatchObject({
      x: 180,
      y: 40,
    });
    expect(frame.players.some((p) => p.id === "d4")).toBe(false);
    expect(frame.players).toHaveLength(12);
  });

  it("exposes a roster for the six attacking positions", () => {
    expect(STANDARD_ROSTER.map((r) => r.label)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
    expect(STANDARD_ROSTER[0]).toEqual({
      playerId: "p1",
      label: "1",
      name: "Vleugel rechts",
    });
  });

  it("colours attack white, defence blue and the keeper red, and swaps with the attack", () => {
    const frame = standardLineup();
    expect(rosterCapTone("p1", frame)).toBe("white");
    expect(rosterCapTone("d1", frame)).toBe("blue");
    expect(rosterCapTone(KEEPER_ID, frame)).toBe("red");
    expect(rosterCapTone("p1", { ...frame, attackColor: "BLUE" })).toBe("blue");
    expect(rosterCapTone("d1", { ...frame, attackColor: "BLUE" })).toBe(
      "white",
    );
    expect(
      rosterCapTone("d9", { attackColor: "WHITE", players: frame.players }),
    ).toBe("blue");
  });
});
