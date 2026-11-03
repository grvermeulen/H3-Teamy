import { describe, expect, it } from "vitest";
import { drillInputSchema } from "../schemas/speelboek";
import {
  AiDrillDraftSchema,
  toDrillInput,
  type AiDrillDraft,
} from "./speelboekDraft";

const base: AiDrillDraft = {
  title: "Tip-in",
  summary: "Actie voor het doel en de bal binnentikken.",
  category: "TECHNIEK",
  level: "GEMIDDELD",
  roster: [
    { team: "OFF", number: 1, name: "Vleugel rechts" },
    { team: "OFF", number: 5, name: "Vleugel links" },
  ],
  steps: [
    {
      title: "Actie",
      text: "1 drijft naar de paal.",
      players: [
        { team: "OFF", number: 1, x: 258, y: 66 },
        { team: "OFF", number: 5, x: 48, y: 66 },
        { team: "DEF", number: 1, x: 238, y: 74 },
      ],
      arrows: [
        { kind: "MOVE", from: { team: "OFF", number: 1 }, toX: 330, toY: -20 },
        { kind: "PASS", from: { team: "OFF", number: 9 }, toX: 100, toY: 100 },
      ],
      ballHolder: { team: "OFF", number: 5 },
      roles: [
        { player: { team: "OFF", number: 1 }, text: "Drijf naar de paal." },
        { player: { team: "DEF", number: 1 }, text: "Niet in roster" },
      ],
    },
  ],
  keyPoints: ["Hand boven water"],
  commonMistakes: [],
};

describe("toDrillInput", () => {
  it("maps model references to diagram ids, clamps coordinates and adds the keeper", () => {
    const { draft } = toDrillInput(base);
    expect(drillInputSchema.safeParse(draft).success).toBe(true);
    expect(draft.published).toBe(false);
    expect(draft.roster.map((r) => r.playerId)).toEqual(["p1", "p5"]);
    const frame = draft.steps[0].frame;
    expect(frame.players.map((p) => p.id)).toEqual(["p1", "p5", "d1", "gk"]);
    expect(frame.arrows).toEqual([
      { kind: "MOVE", playerId: "p1", to: [300, 0] },
    ]);
    expect(frame.ballPlayerId).toBe("p5");
    expect(draft.steps[0].roles).toEqual([
      { playerId: "p1", text: "Drijf naar de paal." },
    ]);
  });

  it("warns about roster players without a role in a step", () => {
    const { warnings } = toDrillInput(base);
    expect(warnings).toEqual([
      'Stap "Actie": geen rol voor Vleugel links – wil je er een toevoegen?',
    ]);
  });

  it("drops an unknown ball holder and falls back to the standard roster", () => {
    const { draft } = toDrillInput({
      ...base,
      roster: [{ team: "GK", number: null, name: "Keeper" }],
      steps: [
        {
          ...base.steps[0],
          ballHolder: { team: "OFF", number: 3 },
          roles: [],
        },
      ],
    });
    expect(draft.steps[0].frame.ballPlayerId).toBeUndefined();
    expect(draft.roster).toEqual([
      { playerId: "gk", label: "K", name: "Keeper" },
    ]);
  });

  it("accepts the shape the prompt asks for, with nulls instead of omitted fields", () => {
    expect(AiDrillDraftSchema.safeParse(base).success).toBe(true);
    const withNulls = {
      ...base,
      steps: [
        {
          ...base.steps[0],
          players: [
            ...base.steps[0].players,
            { team: "GK", number: null, x: 150, y: 19 },
          ],
          ballHolder: null,
        },
      ],
    };
    expect(AiDrillDraftSchema.safeParse(withNulls).success).toBe(true);
    const { draft } = toDrillInput(withNulls as AiDrillDraft);
    expect(draft.steps[0].frame.ballPlayerId).toBeUndefined();
    expect(
      draft.steps[0].frame.players.filter((p) => p.id === "gk"),
    ).toHaveLength(1);
  });
});
