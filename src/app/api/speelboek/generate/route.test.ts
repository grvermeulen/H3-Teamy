import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { generateSpeelboekDrillFromDescription } from "@/lib/ai/speelboekGenerate";
import { isTrainer } from "@/lib/trainer";
import { POST } from "./route";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/trainer", () => ({
  isTrainer: vi.fn(),
}));

vi.mock("@/lib/ai/speelboekGenerate", () => ({
  generateSpeelboekDrillFromDescription: vi.fn(),
}));

const mockedIsTrainer = vi.mocked(isTrainer);
const mockedGenerate = vi.mocked(generateSpeelboekDrillFromDescription);

describe("POST /api/speelboek/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 for non-trainers", async () => {
    mockedIsTrainer.mockResolvedValue({
      isTrainer: false,
      me: { id: "u1", name: "Speler" },
    });
    const res = await POST(
      new Request("http://localhost/api/speelboek/generate", {
        method: "POST",
        body: JSON.stringify({ description: "Tip-in oefening beschrijving" }),
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(403);
    expect(mockedGenerate).not.toHaveBeenCalled();
  });

  it("returns draft for trainers", async () => {
    mockedIsTrainer.mockResolvedValue({
      isTrainer: true,
      me: { id: "t1", name: "Trainer" },
    });
    mockedGenerate.mockResolvedValue({
      title: "Tip-in",
      summary: "Kort",
      category: "TECHNIEK",
      level: "BASIS",
      roster: [{ playerId: "p6", label: "6", name: "Midvoor" }],
      steps: [],
      keyPoints: [],
      commonMistakes: [],
    });
    const res = await POST(
      new Request("http://localhost/api/speelboek/generate", {
        method: "POST",
        body: JSON.stringify({
          description: "Tip-in na actie voor goal met midvoor",
        }),
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: { title: string } };
    expect(body.draft.title).toBe("Tip-in");
  });

  it("captures AI failures to Sentry", async () => {
    mockedIsTrainer.mockResolvedValue({
      isTrainer: true,
      me: { id: "t1", name: "Trainer" },
    });
    mockedGenerate.mockRejectedValue(new Error("GatewayInternalServerError"));
    const res = await POST(
      new Request("http://localhost/api/speelboek/generate", {
        method: "POST",
        body: JSON.stringify({
          description: "Tip-in na actie voor goal met midvoor",
        }),
      }) as unknown as import("next/server").NextRequest,
    );
    expect(res.status).toBe(502);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { module: "speelboek_generate", operation: "generateObject" },
      }),
    );
  });
});
