import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ackCountsByDrill } from "@/lib/services/drillEngagementService";
import { getProgram, setProgram } from "@/lib/services/trainingProgramService";
import { isTrainer } from "@/lib/trainer";
import { GET, PUT } from "./route";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/trainer", () => ({ isTrainer: vi.fn() }));
vi.mock("@/lib/services/trainingProgramService", () => ({
  getProgram: vi.fn(),
  setProgram: vi.fn(),
}));
vi.mock("@/lib/services/drillEngagementService", () => ({
  ackCountsByDrill: vi.fn(),
}));

const trainer = { isTrainer: true, me: { id: "t1", name: "Trainer" } };
const player = { isTrainer: false, me: { id: "p1", name: "Speler" } };
const ctx = (date: string) => ({ params: Promise.resolve({ date }) });
const program = {
  date: "2026-11-05",
  items: [
    {
      id: "i",
      drillId: "tip-in",
      position: 0,
      minutes: 10,
      note: null,
      drill: null,
    },
  ],
};

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/speelboek/program/2026-11-05", {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("/api/speelboek/program/[date]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProgram).mockResolvedValue(program);
    vi.mocked(ackCountsByDrill).mockResolvedValue({ "tip-in": 2 });
  });

  it("GET validates the date", async () => {
    vi.mocked(isTrainer).mockResolvedValue(player);
    expect((await GET(req("GET"), ctx("gisteren"))).status).toBe(400);
  });

  it("GET gives players the programme without ack counts, trainers with", async () => {
    vi.mocked(isTrainer).mockResolvedValue(player);
    let json = await (await GET(req("GET"), ctx("2026-11-05"))).json();
    expect(json.items).toHaveLength(1);
    expect(json.ackCounts).toBeUndefined();
    expect(getProgram).toHaveBeenCalledWith("2026-11-05", false);

    vi.mocked(isTrainer).mockResolvedValue(trainer);
    json = await (await GET(req("GET"), ctx("2026-11-05"))).json();
    expect(json.ackCounts).toEqual({ "tip-in": 2 });
    expect(getProgram).toHaveBeenLastCalledWith("2026-11-05", true);
  });

  it("PUT is trainer-only and validates items", async () => {
    vi.mocked(isTrainer).mockResolvedValue(player);
    expect(
      (await PUT(req("PUT", { items: [] }), ctx("2026-11-05"))).status,
    ).toBe(403);
    vi.mocked(isTrainer).mockResolvedValue(trainer);
    expect(
      (await PUT(req("PUT", { items: "x" }), ctx("2026-11-05"))).status,
    ).toBe(400);
    vi.mocked(setProgram).mockResolvedValue(null);
    const unknown = await PUT(
      req("PUT", { items: [{ drillId: "weg" }] }),
      ctx("2026-11-05"),
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({
      issues: [{ message: "Onbekende of dubbele oefening" }],
    });
  });

  it("PUT saves and returns the programme", async () => {
    vi.mocked(isTrainer).mockResolvedValue(trainer);
    vi.mocked(setProgram).mockResolvedValue(program);
    const res = await PUT(
      req("PUT", { items: [{ drillId: "tip-in", minutes: 10 }] }),
      ctx("2026-11-05"),
    );
    expect(res.status).toBe(200);
    expect(setProgram).toHaveBeenCalledWith("2026-11-05", [
      { drillId: "tip-in", minutes: 10 },
    ]);
  });
});
