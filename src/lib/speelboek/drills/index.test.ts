import { describe, expect, it } from "vitest";
import { drillSchema } from "../../schemas/speelboek";
import { DRILLS } from "./index";

describe("speelboek content", () => {
  it("has unique slugs and validates against the schema", () => {
    const ids = DRILLS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const drill of DRILLS) {
      expect(() => drillSchema.parse(drill)).not.toThrow();
    }
  });

  it("references only players that exist in every step's frame", () => {
    for (const drill of DRILLS) {
      for (const step of drill.steps) {
        const ids = new Set(step.frame.players.map((p) => p.id));
        for (const entry of drill.roster) {
          expect(
            ids,
            `${drill.id}/${step.title}: roster ${entry.playerId}`,
          ).toContain(entry.playerId);
        }
        for (const role of step.roles) {
          expect(
            ids,
            `${drill.id}/${step.title}: role ${role.playerId}`,
          ).toContain(role.playerId);
        }
        for (const arrow of step.frame.arrows) {
          expect(
            ids,
            `${drill.id}/${step.title}: arrow ${arrow.playerId}`,
          ).toContain(arrow.playerId);
        }
        if (step.frame.ballPlayerId) {
          expect(ids).toContain(step.frame.ballPlayerId);
        }
      }
    }
  });

  it("gives every roster player a role in every step", () => {
    for (const drill of DRILLS) {
      for (const step of drill.steps) {
        const withRole = new Set(step.roles.map((r) => r.playerId));
        for (const entry of drill.roster) {
          expect(
            withRole,
            `${drill.id}/${step.title}: ${entry.playerId}`,
          ).toContain(entry.playerId);
        }
      }
    }
  });

  it("has exactly one keeper per frame and resolvable counterparts", () => {
    const ids = new Set(DRILLS.map((d) => d.id));
    for (const drill of DRILLS) {
      for (const step of drill.steps) {
        expect(step.frame.players.filter((p) => p.team === "GK")).toHaveLength(
          1,
        );
      }
      if (drill.counterpartId) {
        expect(ids).toContain(drill.counterpartId);
      }
    }
  });

  it("includes Henry's tip-in", () => {
    expect(DRILLS.find((d) => d.id === "tip-in")?.category).toBe("TECHNIEK");
  });
});
