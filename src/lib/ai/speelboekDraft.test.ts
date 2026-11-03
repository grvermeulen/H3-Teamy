import { beforeEach, describe, expect, it, vi } from "vitest";
import { drillInputSchema } from "../schemas/speelboek";
import {
  AiDrillDraftSchema,
  SPEELBOEK_DRAFT_SYSTEM_PROMPT,
  SPEELBOEK_PHOTO_HINT,
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
  unreadable: [],
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

  it("keeps titles, step text, roles, key points and names from the board", () => {
    const written: AiDrillDraft = {
      ...base,
      title: "Extra man 4-3",
      summary: "Na de extra pass de bal naar 1.",
      roster: [
        { team: "OFF", number: 1, name: "Sem" },
        { team: "OFF", number: 6, name: "Center" },
      ],
      steps: [
        {
          ...base.steps[0],
          title: "Pass naar de vleugel",
          text: "6 past naar 1, 1 schiet direct.",
          roles: [
            {
              player: { team: "OFF", number: 1 },
              text: "Schiet zonder te pakken.",
            },
            {
              player: { team: "OFF", number: 6 },
              text: "Kijk eerst naar de keeper.",
            },
          ],
        },
      ],
      keyPoints: ["Bal niet pakken", "Keeper uit de goal lokken"],
      commonMistakes: ["1 pakt de bal eerst"],
      unreadable: [],
    };
    const { draft, warnings } = toDrillInput(written);
    expect(draft.title).toBe("Extra man 4-3");
    expect(draft.summary).toBe("Na de extra pass de bal naar 1.");
    expect(draft.steps[0].title).toBe("Pass naar de vleugel");
    expect(draft.steps[0].text).toBe("6 past naar 1, 1 schiet direct.");
    expect(draft.steps[0].roles).toEqual([
      { playerId: "p1", text: "Schiet zonder te pakken." },
      { playerId: "p6", text: "Kijk eerst naar de keeper." },
    ]);
    expect(draft.keyPoints).toEqual([
      "Bal niet pakken",
      "Keeper uit de goal lokken",
    ]);
    expect(draft.commonMistakes).toEqual(["1 pakt de bal eerst"]);
    expect(draft.roster.map((r) => r.name)).toEqual(["Sem", "Center"]);
    expect(warnings).toEqual([]);
  });

  it("warns in Dutch when writing on the photo could not be read", () => {
    const { draft, warnings } = toDrillInput({
      ...base,
      unreadable: ["rol bij 6", "titel van stap 2"],
    });
    expect(warnings).toEqual([
      'Stap "Actie": geen rol voor Vleugel links – wil je er een toevoegen?',
      "Tekst op de foto niet leesbaar (rol bij 6) – wil je die aanvullen?",
      "Tekst op de foto niet leesbaar (titel van stap 2) – wil je die aanvullen?",
    ]);
    expect(draft.title).toBe(base.title);
    expect(draft.steps[0].text).toBe(base.steps[0].text);
    expect(draft.steps[0].text).not.toContain("rol bij 6");
  });
});

describe("whiteboard photo instructions", () => {
  it("requires the model to use written text on the image and not invent it", () => {
    for (const prompt of [
      SPEELBOEK_DRAFT_SYSTEM_PROMPT,
      SPEELBOEK_PHOTO_HINT,
    ]) {
      expect(prompt).toContain("geschreven");
      expect(prompt.toLowerCase()).toContain("titel");
      expect(prompt.toLowerCase()).toContain("rol");
      expect(prompt.toLowerCase()).toContain("kernpunt");
      expect(prompt.toLowerCase()).toContain("namen");
      expect(prompt.toLowerCase()).toContain("verzin geen");
      expect(prompt.toLowerCase()).toContain("onleesbaar");
    }
  });
});

const PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("draftDrill", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("sends the photo hint and the image without calling a live model", async () => {
    const generateObject = vi.fn(async () => ({ object: base }));
    vi.doMock("./client", () => ({ generateObject }));
    const mod = await import("./speelboekDraft");
    const { draft } = await mod.draftDrill({
      description: "Center noemt de extra.",
      imageDataUrl: PHOTO,
    });
    expect(draft.title).toBe("Tip-in");
    expect(generateObject).toHaveBeenCalledTimes(1);
    const args = generateObject.mock.calls[0][0] as {
      system: string;
      messages: {
        content: { type: string; text?: string; mediaType?: string }[];
      }[];
    };
    expect(args.system).toBe(mod.SPEELBOEK_DRAFT_SYSTEM_PROMPT);
    const text = args.messages[0].content.find(
      (part) => part.type === "text",
    )?.text;
    expect(text).toContain("Center noemt de extra.");
    expect(text).toContain(mod.SPEELBOEK_PHOTO_HINT);
    expect(text).not.toContain("Er is geen tekst;");
    expect(
      args.messages[0].content.find((part) => part.type === "image")?.mediaType,
    ).toBe("image/png");
  });

  it("tells a photo-only draft to read the writing on the board", async () => {
    const generateObject = vi.fn(async () => ({ object: base }));
    vi.doMock("./client", () => ({ generateObject }));
    const mod = await import("./speelboekDraft");
    await mod.draftDrill({ description: "", imageDataUrl: PHOTO });
    const args = generateObject.mock.calls[0][0] as {
      messages: { content: { type: string; text?: string }[] }[];
    };
    const text = args.messages[0].content.find(
      (part) => part.type === "text",
    )?.text;
    expect(text).toContain(
      "Er is geen getypte beschrijving; lees de oefening van de whiteboardfoto, inclusief de tekst die erop geschreven staat.",
    );
    expect(text).toContain(mod.SPEELBOEK_PHOTO_HINT);
  });

  it("omits the photo hint when there is no image", async () => {
    const generateObject = vi.fn(async () => ({ object: base }));
    vi.doMock("./client", () => ({ generateObject }));
    const mod = await import("./speelboekDraft");
    await mod.draftDrill({ description: "1 past naar 6." });
    const args = generateObject.mock.calls[0][0] as {
      messages: { content: { type: string; text?: string }[] }[];
    };
    const text =
      args.messages[0].content.find((part) => part.type === "text")?.text ?? "";
    expect(text).toContain("1 past naar 6.");
    expect(text).not.toContain(mod.SPEELBOEK_PHOTO_HINT);
    expect(args.messages[0].content.some((part) => part.type === "image")).toBe(
      false,
    );
  });

  it("propagates errors from the model call", async () => {
    vi.doMock("./client", () => ({
      generateObject: () => {
        throw new Error("boom");
      },
    }));
    const mod = await import("./speelboekDraft");
    await expect(
      mod.draftDrill({ description: "1 past naar 6." }),
    ).rejects.toThrow("boom");
  });
});
