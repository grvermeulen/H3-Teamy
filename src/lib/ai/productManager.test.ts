import { describe, it, expect, vi, beforeEach } from "vitest";
import { IdeaShapeSchema, PM_SYSTEM_PROMPT, shapeIdea } from "./productManager";

describe("IdeaShapeSchema", () => {
  it("accepts a well-formed shape", () => {
    const r = IdeaShapeSchema.safeParse({
      aiTheme: "RSVP UX",
      aiImpact: "Medium",
      aiSummary: "Make the tap target bigger.",
      questions: ["Which screen?", "Mobile only?"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown impact level", () => {
    const r = IdeaShapeSchema.safeParse({
      aiTheme: "RSVP UX",
      aiImpact: "Massive",
      aiSummary: "x",
      questions: [],
    });
    expect(r.success).toBe(false);
  });

  it("caps questions at 3", () => {
    const r = IdeaShapeSchema.safeParse({
      aiTheme: "X",
      aiImpact: "Low",
      aiSummary: "Y",
      questions: ["a?", "b?", "c?", "d?"],
    });
    expect(r.success).toBe(false);
  });
});

describe("PM_SYSTEM_PROMPT", () => {
  it("mentions the four required JSON fields", () => {
    expect(PM_SYSTEM_PROMPT).toContain("aiTheme");
    expect(PM_SYSTEM_PROMPT).toContain("aiImpact");
    expect(PM_SYSTEM_PROMPT).toContain("aiSummary");
    expect(PM_SYSTEM_PROMPT).toContain("questions");
  });
});

describe("shapeIdea", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls the AI SDK with the structured gateway model and returns the parsed object", async () => {
    const generateObject = vi.fn(async () => ({
      object: {
        aiTheme: "RSVP UX",
        aiImpact: "High",
        aiSummary: "Bigger button.",
        questions: ["Mobile only?"],
      },
    }));
    vi.doMock("./client", () => ({ generateObject }));
    const mod = await import("./productManager");
    const out = await mod.shapeIdea({
      title: "Bigger Yes button",
      body: "Tap target is too small on phones.",
    });
    expect(out.aiTheme).toBe("RSVP UX");
    expect(generateObject).toHaveBeenCalledTimes(1);
    const args = generateObject.mock.calls[0][0] as {
      model: string;
      system: string;
    };
    expect(args.model).toBe("anthropic/claude-sonnet-4");
    expect(args.system).toBe(PM_SYSTEM_PROMPT);
  });

  // Smoke test that direct call rejects when SDK is unavailable in this env
  it("propagates errors from the SDK", async () => {
    vi.doMock("./client", () => ({
      generateObject: () => {
        throw new Error("boom");
      },
    }));
    const mod = await import("./productManager");
    await expect(
      mod.shapeIdea({ title: "x".repeat(10), body: "y".repeat(10) }),
    ).rejects.toThrow("boom");
  });
});

describe("export surface", () => {
  it("exports shapeIdea as a function", () => {
    expect(typeof shapeIdea).toBe("function");
  });
});
