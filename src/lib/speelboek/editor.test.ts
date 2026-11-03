import { describe, expect, it } from "vitest";
import { drillInputSchema } from "../schemas/speelboek";
import { DRILLS } from "./drills";
import {
  addArrow,
  addPlayer,
  defaultRosterEntry,
  drillToInput,
  hitTest,
  linesToList,
  movePlayer,
  newDrillInput,
  nextStepFrame,
  removePlayer,
  setRole,
  trimStepRoles,
  toggleAttackColor,
  toggleRoster,
  validateDrillInput,
} from "./editor";
import { standardLineup } from "./lineup";

describe("speelboek editor", () => {
  it("starts from the standard lineup with six roster positions and one step", () => {
    const input = newDrillInput();
    expect(input.steps).toHaveLength(1);
    expect(input.steps[0].frame.players).toHaveLength(13);
    expect(input.roster.map((r) => r.playerId)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
    ]);
    expect(input.published).toBe(false);
  });

  it("converts a drill to editor input and back through the schema", () => {
    const input = drillToInput(DRILLS[0], true);
    expect(input).not.toHaveProperty("id");
    expect(input).not.toHaveProperty("addedOn");
    expect(drillInputSchema.safeParse(input).success).toBe(true);
    expect(input.steps).not.toBe(DRILLS[0].steps);
  });

  it("hit-tests the nearest cap within the radius", () => {
    const frame = standardLineup();
    expect(hitTest(frame, [150, 118])).toBe("p3");
    expect(hitTest(frame, [158, 112])).toBe("p3");
    expect(hitTest(frame, [150, 75])).toBeNull();
  });

  it("moves players within the pool bounds", () => {
    const frame = movePlayer(standardLineup(), "p1", [320, -5]);
    const p1 = frame.players.find((p) => p.id === "p1")!;
    expect([p1.x, p1.y]).toEqual([300, 0]);
  });

  it("adds arrows, replacing an earlier pass or shot by the same player", () => {
    let frame = addArrow(standardLineup(), {
      kind: "PASS",
      playerId: "p3",
      to: [232, 112],
    });
    frame = addArrow(frame, { kind: "PASS", playerId: "p3", to: [70, 112] });
    frame = addArrow(frame, { kind: "MOVE", playerId: "p1", to: [240, 40] });
    frame = addArrow(frame, { kind: "MOVE", playerId: "p1", to: [220, 30] });
    expect(frame.arrows.filter((a) => a.kind === "PASS")).toHaveLength(1);
    expect(frame.arrows.find((a) => a.kind === "PASS")?.to).toEqual([70, 112]);
    expect(frame.arrows.filter((a) => a.kind === "MOVE")).toHaveLength(2);
  });

  it("removes a player with their arrows and ball", () => {
    let frame = addArrow(standardLineup(), {
      kind: "SHOT",
      playerId: "p3",
      to: [150, 10],
    });
    frame = removePlayer(frame, "p3");
    expect(frame.players.some((p) => p.id === "p3")).toBe(false);
    expect(frame.arrows).toEqual([]);
    expect(frame.ballPlayerId).toBeUndefined();
  });

  it("adds players with the next free id and a single keeper", () => {
    const base = removePlayer(standardLineup(), "d4");
    const added = addPlayer(base, "DEF");
    expect(added.playerId).toBe("d4");
    const extra = addPlayer(added.frame, "OFF", [10, 10]);
    expect(extra.playerId).toBe("p7");
    expect(extra.frame.players.find((p) => p.id === "p7")).toMatchObject({
      x: 10,
      y: 10,
    });
    const keeper = addPlayer(extra.frame, "GK");
    expect(keeper.frame).toBe(extra.frame);
  });

  it("derives the next step: swims applied, ball follows the pass, arrows cleared", () => {
    let frame = addArrow(standardLineup(), {
      kind: "MOVE",
      playerId: "p1",
      to: [250, 40],
    });
    frame = addArrow(frame, { kind: "PASS", playerId: "p3", to: [236, 110] });
    const next = nextStepFrame(frame);
    expect(next.players.find((p) => p.id === "p1")).toMatchObject({
      x: 250,
      y: 40,
    });
    expect(next.ballPlayerId).toBe("p2");
    expect(next.arrows).toEqual([]);
    expect(next.attackColor).toBe(frame.attackColor);
  });

  it("keeps the ball when a pass ends in open water", () => {
    const frame = addArrow(standardLineup(), {
      kind: "PASS",
      playerId: "p3",
      to: [20, 140],
    });
    expect(nextStepFrame(frame).ballPlayerId).toBe("p3");
  });

  it("toggles attack colour", () => {
    expect(toggleAttackColor(standardLineup()).attackColor).toBe("BLUE");
  });

  it("builds default roster entries per id", () => {
    expect(defaultRosterEntry("p6")).toEqual({
      playerId: "p6",
      label: "6",
      name: "Midvoor",
    });
    expect(defaultRosterEntry("p7")).toEqual({
      playerId: "p7",
      label: "7",
      name: "Aanvaller 7",
    });
    expect(defaultRosterEntry("d2")).toEqual({
      playerId: "d2",
      label: "V2",
      name: "Verdediger 2",
    });
    expect(defaultRosterEntry("gk")).toEqual({
      playerId: "gk",
      label: "K",
      name: "Keeper",
    });
  });

  it("sets, replaces and clears roles without eating spaces while typing", () => {
    const step = newDrillInput().steps[0];
    const withRole = setRole(step, "p1", "Drijf ");
    expect(withRole.roles).toEqual([{ playerId: "p1", text: "Drijf " }]);
    expect(setRole(withRole, "p1", "Vraag de bal").roles).toEqual([
      { playerId: "p1", text: "Vraag de bal" },
    ]);
    expect(setRole(withRole, "p1", "   ").roles).toEqual([]);
    expect(
      trimStepRoles(setRole(step, "p1", "  Drijf naar de paal ")).roles,
    ).toEqual([{ playerId: "p1", text: "Drijf naar de paal" }]);
  });

  it("toggles roster membership and drops roles of removed players", () => {
    let input = newDrillInput();
    input = { ...input, steps: [setRole(input.steps[0], "p1", "x")] };
    input = toggleRoster(input, "p1");
    expect(input.roster.some((r) => r.playerId === "p1")).toBe(false);
    expect(input.steps[0].roles).toEqual([]);
    input = toggleRoster(input, "gk");
    expect(input.roster.at(-1)).toEqual({
      playerId: "gk",
      label: "K",
      name: "Keeper",
    });
  });

  it("splits textarea lines and validates the obvious gaps", () => {
    expect(linesToList(" a \n\n b\n")).toEqual(["a", "b"]);
    const problems = validateDrillInput(newDrillInput());
    expect(problems).toContain("Geef de oefening een titel.");
    expect(problems).toContain("Stap 1 heeft geen uitleg.");
    const ok = drillToInput(DRILLS[0], true);
    expect(validateDrillInput(ok)).toEqual([]);
  });
});
