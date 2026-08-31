import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AttendanceNudgeSchema,
  NUDGE_SYSTEM_PROMPT,
  generateAttendanceNudge,
} from "./attendanceNudge";

describe("AttendanceNudgeSchema", () => {
  it("accepts a well-formed encourage payload", () => {
    const r = AttendanceNudgeSchema.safeParse({
      tone: "encourage",
      message: "Hee, de bak mist je. Tot woensdag?",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a well-formed cheer payload", () => {
    const r = AttendanceNudgeSchema.safeParse({
      tone: "cheer",
      message: "Twee weken full house — de hele bak ziet je trekken.",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown tone", () => {
    const r = AttendanceNudgeSchema.safeParse({
      tone: "scold",
      message: "x".repeat(20),
    });
    expect(r.success).toBe(false);
  });

  it("rejects messages over the 220 char cap", () => {
    const r = AttendanceNudgeSchema.safeParse({
      tone: "cheer",
      message: "x".repeat(221),
    });
    expect(r.success).toBe(false);
  });
});

describe("NUDGE_SYSTEM_PROMPT", () => {
  it("mentions both tones", () => {
    expect(NUDGE_SYSTEM_PROMPT).toContain("encourage");
    expect(NUDGE_SYSTEM_PROMPT).toContain("cheer");
  });

  it("instructs the model to write in Dutch", () => {
    expect(NUDGE_SYSTEM_PROMPT).toContain("NL");
  });

  it("forbids shaming", () => {
    expect(NUDGE_SYSTEM_PROMPT.toLowerCase()).toContain("nooit beschamend");
  });

  it("instructs the model not to invent a training day", () => {
    expect(NUDGE_SYSTEM_PROMPT).toContain("Eerstvolgende training");
    expect(NUDGE_SYSTEM_PROMPT).toContain("Verzin NOOIT");
  });
});

describe("generateAttendanceNudge", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls the AI SDK with the structured gateway model and returns the parsed object", async () => {
    const generateObject = vi.fn(async () => ({
      object: {
        tone: "encourage",
        message: "Druk gehad? Geen ramp. Woensdag staat de bak klaar.",
      },
    }));
    vi.doMock("./client", () => ({ generateObject }));
    const mod = await import("./attendanceNudge");
    const out = await mod.generateAttendanceNudge({
      tone: "encourage",
      attended: 1,
      total: 4,
      firstName: "Joost",
      nextTrainingLabel: "woensdag",
    });
    expect(out.tone).toBe("encourage");
    expect(generateObject).toHaveBeenCalledTimes(1);
    const args = generateObject.mock.calls[0][0] as {
      model: string;
      system: string;
      prompt: string;
    };
    expect(args.model).toBe("openai/gpt-4o");
    expect(args.system).toBe(NUDGE_SYSTEM_PROMPT);
    expect(args.prompt).toContain("Joost");
    expect(args.prompt).toContain("1 van 4");
    expect(args.prompt).toContain("encourage");
    expect(args.prompt).toContain("Eerstvolgende training: woensdag");
  });

  it("omits the firstName and next-training lines when not provided", async () => {
    const generateObject = vi.fn(async () => ({
      object: { tone: "cheer", message: "Top — alle trainingen erop zitten." },
    }));
    vi.doMock("./client", () => ({ generateObject }));
    const mod = await import("./attendanceNudge");
    await mod.generateAttendanceNudge({ tone: "cheer", attended: 4, total: 4 });
    const args = generateObject.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).not.toContain("Voornaam:");
    expect(args.prompt).not.toContain("Eerstvolgende training");
  });

  it("does not pass the next-training label for cheer tone", async () => {
    const generateObject = vi.fn(async () => ({
      object: { tone: "cheer", message: "Twee weken full house — top." },
    }));
    vi.doMock("./client", () => ({ generateObject }));
    const mod = await import("./attendanceNudge");
    await mod.generateAttendanceNudge({
      tone: "cheer",
      attended: 4,
      total: 4,
      nextTrainingLabel: "woensdag",
    });
    const args = generateObject.mock.calls[0][0] as { prompt: string };
    expect(args.prompt).not.toContain("Eerstvolgende training");
  });

  it("propagates errors from the SDK", async () => {
    vi.doMock("./client", () => ({
      generateObject: () => {
        throw new Error("boom");
      },
    }));
    const mod = await import("./attendanceNudge");
    await expect(
      mod.generateAttendanceNudge({ tone: "encourage", attended: 0, total: 4 }),
    ).rejects.toThrow("boom");
  });
});
