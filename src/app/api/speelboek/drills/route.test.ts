import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DRILLS } from "@/lib/speelboek/drills";
import { drillToInput } from "@/lib/speelboek/editor";
import { getAllDrills } from "@/lib/services/speelboekService";
import { createStoredDrill } from "@/lib/services/speelboekStore";
import { isTrainer } from "@/lib/trainer";
import { GET, POST } from "./route";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/trainer", () => ({ isTrainer: vi.fn() }));
vi.mock("@/lib/services/speelboekService", () => ({ getAllDrills: vi.fn() }));
vi.mock("@/lib/services/speelboekStore", () => ({
  createStoredDrill: vi.fn(),
}));

const trainer = { isTrainer: true, me: { id: "t1", name: "Trainer" } };
const player = { isTrainer: false, me: { id: "p1", name: "Speler" } };

function post(body: unknown): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/speelboek/drills", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("/api/speelboek/drills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllDrills).mockResolvedValue([]);
  });

  it("GET includes drafts only for trainers", async () => {
    vi.mocked(isTrainer).mockResolvedValue(player);
    await GET(
      new NextRequest(new Request("http://localhost/api/speelboek/drills")),
    );
    expect(getAllDrills).toHaveBeenCalledWith(false);
    vi.mocked(isTrainer).mockResolvedValue(trainer);
    await GET(
      new NextRequest(new Request("http://localhost/api/speelboek/drills")),
    );
    expect(getAllDrills).toHaveBeenCalledWith(true);
  });

  it("POST rejects players", async () => {
    vi.mocked(isTrainer).mockResolvedValue(player);
    const res = await POST(post(drillToInput(DRILLS[0], true)));
    expect(res.status).toBe(403);
    expect(createStoredDrill).not.toHaveBeenCalled();
  });

  it("POST validates the body", async () => {
    vi.mocked(isTrainer).mockResolvedValue(trainer);
    const res = await POST(post({ title: "x" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Ongeldige invoer" });
  });

  it("POST creates a drill for the trainer", async () => {
    vi.mocked(isTrainer).mockResolvedValue(trainer);
    vi.mocked(createStoredDrill).mockResolvedValue({
      ...DRILLS[0],
      id: "nieuw",
      published: true,
      createdById: "t1",
      updatedAt: "2026-11-03T00:00:00.000Z",
    });
    const res = await POST(post(drillToInput(DRILLS[0], true)));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ drill: { id: "nieuw" } });
    expect(createStoredDrill).toHaveBeenCalledWith(
      expect.objectContaining({ title: DRILLS[0].title, published: true }),
      "t1",
    );
  });

  it("POST reports failures as 500 without details", async () => {
    vi.mocked(isTrainer).mockResolvedValue(trainer);
    vi.mocked(createStoredDrill).mockRejectedValue(new Error("db"));
    const res = await POST(post(drillToInput(DRILLS[0], true)));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Er ging iets mis" });
  });
});
