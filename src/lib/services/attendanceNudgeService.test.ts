import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

const { kvGetJson, kvSetJson, getAttendanceForDates, generateAttendanceNudge } =
  vi.hoisted(() => ({
    kvGetJson: vi.fn(),
    kvSetJson: vi.fn(),
    getAttendanceForDates: vi.fn(),
    generateAttendanceNudge: vi.fn(),
  }));

vi.mock("../kv", () => ({
  kvGetJson,
  kvSetJson,
  getAttendanceForDates,
}));

vi.mock("../ai/attendanceNudge", () => ({
  generateAttendanceNudge,
}));

import {
  decideNudgeBucket,
  computeRecentAttendance,
  getOrCreateNudge,
} from "./attendanceNudgeService";

describe("decideNudgeBucket", () => {
  it("returns null when fewer than 2 trainings are scheduled", () => {
    expect(decideNudgeBucket(0, 0)).toBeNull();
    expect(decideNudgeBucket(1, 1)).toBeNull();
  });

  it("flags 100% as a cheer when at least 2 trainings attended", () => {
    expect(decideNudgeBucket(2, 2)).toEqual({
      tone: "cheer",
      attended: 2,
      total: 2,
      pct: 100,
    });
    expect(decideNudgeBucket(4, 4)).toEqual({
      tone: "cheer",
      attended: 4,
      total: 4,
      pct: 100,
    });
  });

  it("flags below 50% as an encouragement", () => {
    expect(decideNudgeBucket(1, 4)).toEqual({
      tone: "encourage",
      attended: 1,
      total: 4,
      pct: 25,
    });
    expect(decideNudgeBucket(0, 4)).toEqual({
      tone: "encourage",
      attended: 0,
      total: 4,
      pct: 0,
    });
  });

  it("returns null for the mid-range (50%–<100%)", () => {
    expect(decideNudgeBucket(2, 4)).toBeNull(); // 50%
    expect(decideNudgeBucket(3, 4)).toBeNull(); // 75%
    expect(decideNudgeBucket(3, 5)).toBeNull(); // 60%
  });

  it("guards against impossible inputs", () => {
    expect(decideNudgeBucket(-1, 4)).toBeNull();
    expect(decideNudgeBucket(5, 4)).toBeNull();
    expect(decideNudgeBucket(Number.NaN, 4)).toBeNull();
    expect(decideNudgeBucket(2, Number.NaN)).toBeNull();
  });
});

describe("computeRecentAttendance", () => {
  beforeEach(() => {
    getAttendanceForDates.mockReset();
  });

  it("counts attendance over the rolling 14-day window", async () => {
    // Wed 2025-09-03 and Fri 2025-09-05 fall inside a 2-week window ending 2025-09-10
    const today = new Date("2025-09-10T12:00:00Z");
    getAttendanceForDates.mockResolvedValue({
      "2025-08-29": ["other"],
      "2025-09-03": ["u1", "u2"],
      "2025-09-05": ["u1"],
    });
    const out = await computeRecentAttendance("u1", today);
    expect(out.total).toBeGreaterThanOrEqual(2);
    expect(out.attended).toBe(2);
  });

  it("returns 0/0 when the window has no scheduled trainings", async () => {
    // Force an empty window via stub: any small window without Wed/Fri
    getAttendanceForDates.mockResolvedValue({});
    const out = await computeRecentAttendance(
      "u1",
      new Date("2025-09-10T12:00:00Z"),
    );
    expect(out.attended).toBe(0);
    expect(typeof out.total).toBe("number");
  });
});

describe("getOrCreateNudge", () => {
  beforeEach(() => {
    kvGetJson.mockReset();
    kvSetJson.mockReset();
    kvSetJson.mockResolvedValue(undefined);
    generateAttendanceNudge.mockReset();
  });

  const today = new Date("2025-09-10T12:00:00Z");
  const bucket = {
    tone: "encourage" as const,
    attended: 1,
    total: 4,
    pct: 25,
  };

  it("returns the cached nudge without invoking the LLM", async () => {
    kvGetJson.mockResolvedValue({
      tone: "encourage",
      message: "Cached message — just come back!",
    });
    const out = await getOrCreateNudge("u1", bucket, { today });
    expect(out.message).toBe("Cached message — just come back!");
    expect(generateAttendanceNudge).not.toHaveBeenCalled();
    expect(kvSetJson).not.toHaveBeenCalled();
  });

  it("invokes the LLM and caches the result on a miss, passing the next-training label", async () => {
    kvGetJson.mockResolvedValue(null);
    generateAttendanceNudge.mockResolvedValue({
      tone: "encourage",
      message: "Fresh AI message.",
    });
    // 2025-09-10 is a Wednesday, so next training is "vandaag".
    const out = await getOrCreateNudge("u1", bucket, {
      firstName: "Joost",
      today,
    });
    expect(out.message).toBe("Fresh AI message.");
    expect(generateAttendanceNudge).toHaveBeenCalledWith({
      tone: "encourage",
      attended: 1,
      total: 4,
      firstName: "Joost",
      nextTrainingLabel: "vandaag",
    });
    expect(kvSetJson).toHaveBeenCalledTimes(1);
    const [key] = kvSetJson.mock.calls[0];
    expect(key).toContain("nudge:v2:u1:2025-09-10:encourage:1of4");
  });

  it("passes 'woensdag' when today is the preceding Saturday", async () => {
    kvGetJson.mockResolvedValue(null);
    generateAttendanceNudge.mockResolvedValue({
      tone: "encourage",
      message: "Tot woensdag!",
    });
    // Saturday 2025-09-06; next training is Wednesday 2025-09-10.
    await getOrCreateNudge("u1", bucket, {
      today: new Date(2025, 8, 6),
    });
    const args = generateAttendanceNudge.mock.calls[0][0];
    expect(args.nextTrainingLabel).toBe("woensdag");
  });

  it("passes 'morgen' the day before a training day", async () => {
    kvGetJson.mockResolvedValue(null);
    generateAttendanceNudge.mockResolvedValue({
      tone: "encourage",
      message: "Tot morgen!",
    });
    // Tuesday 2025-09-09; next training is Wednesday 2025-09-10 → "morgen".
    await getOrCreateNudge("u1", bucket, {
      today: new Date(2025, 8, 9),
    });
    const args = generateAttendanceNudge.mock.calls[0][0];
    expect(args.nextTrainingLabel).toBe("morgen");
  });

  it("does not pass a next-training label for cheer tone", async () => {
    kvGetJson.mockResolvedValue(null);
    generateAttendanceNudge.mockResolvedValue({
      tone: "cheer",
      message: "Top!",
    });
    await getOrCreateNudge(
      "u1",
      { tone: "cheer", attended: 4, total: 4, pct: 100 },
      { today },
    );
    const args = generateAttendanceNudge.mock.calls[0][0];
    expect(args.nextTrainingLabel).toBeUndefined();
  });

  it("falls back to a static Dutch encourage message that names the next training day when the LLM throws", async () => {
    kvGetJson.mockResolvedValue(null);
    generateAttendanceNudge.mockRejectedValue(new Error("ai down"));
    // Saturday → next training is Wednesday.
    const out = await getOrCreateNudge("u1", bucket, {
      today: new Date(2025, 8, 6),
    });
    expect(out.tone).toBe("encourage");
    expect(out.message).toContain("woensdag");
    expect(out.message).toMatch(/bak ligt klaar/);
    expect(kvSetJson).not.toHaveBeenCalled();
  });

  it("falls back to a static Dutch cheer message when the LLM throws", async () => {
    kvGetJson.mockResolvedValue(null);
    generateAttendanceNudge.mockRejectedValue(new Error("ai down"));
    const out = await getOrCreateNudge(
      "u1",
      { tone: "cheer", attended: 4, total: 4, pct: 100 },
      { today },
    );
    expect(out.tone).toBe("cheer");
    expect(out.message).toMatch(/Alle trainingen erop zitten/);
  });

  it("ignores a cache row whose tone no longer matches the bucket", async () => {
    kvGetJson.mockResolvedValue({
      tone: "cheer",
      message: "stale cheer",
    });
    generateAttendanceNudge.mockResolvedValue({
      tone: "encourage",
      message: "fresh encourage",
    });
    const out = await getOrCreateNudge("u1", bucket, { today });
    expect(out.message).toBe("fresh encourage");
  });
});
