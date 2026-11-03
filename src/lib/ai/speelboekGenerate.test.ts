import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { generateSpeelboekDrillFromDescription } from "./speelboekGenerate";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

const generateObject = vi.fn();

vi.mock("./client", () => ({
  generateObject: (...args: unknown[]) => generateObject(...args),
}));

describe("generateSpeelboekDrillFromDescription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls generateObject with the strict speelboek schema", async () => {
    generateObject.mockResolvedValue({
      object: {
        title: "Tip-in",
        summary: "Actie voor de goal",
        category: "TECHNIEK",
        level: "BASIS",
        roster: [{ playerId: "p6", label: "6", name: "Midvoor" }],
        steps: [
          {
            title: "Start",
            text: "Bal naar midvoor.",
            frame: {
              attackColor: "WHITE",
              players: [{ id: "p6", team: "OFF", x: 150, y: 58 }],
              arrows: [],
              ballPlayerId: "p3",
            },
            roles: [{ playerId: "p6", text: "Ontvang de pass." }],
          },
        ],
        keyPoints: ["Timing"],
        commonMistakes: ["Te vroeg loslaten"],
      },
    });

    const draft = await generateSpeelboekDrillFromDescription(
      "Oefening tip-in na actie voor goal",
    );

    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(draft.title).toBe("Tip-in");
    expect(draft.roster[0]?.label).toBe("6");
    expect(draft.steps[0]?.frame.ballPlayerId).toBe("p3");
  });

  it("surfaces gateway failures via rejection", async () => {
    generateObject.mockRejectedValue(new Error("GatewayInternalServerError"));
    await expect(
      generateSpeelboekDrillFromDescription("test"),
    ).rejects.toThrow(/GatewayInternalServerError/);
    expect(vi.mocked(Sentry.captureException)).not.toHaveBeenCalled();
  });
});
