import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DRILLS } from "@/lib/speelboek/drills";
import { drillToInput } from "@/lib/speelboek/editor";
import { findDrill, isStaticDrill } from "@/lib/services/speelboekService";
import {
  deleteStoredDrill,
  updateStoredDrill,
} from "@/lib/services/speelboekStore";
import { isTrainer } from "@/lib/trainer";
import { DELETE, GET, PUT } from "./route";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/trainer", () => ({ isTrainer: vi.fn() }));
vi.mock("@/lib/services/speelboekService", () => ({
  findDrill: vi.fn(),
  isStaticDrill: vi.fn(),
}));
vi.mock("@/lib/services/speelboekStore", () => ({
  updateStoredDrill: vi.fn(),
  deleteStoredDrill: vi.fn(),
}));

const trainer = { isTrainer: true, me: { id: "t1", name: "Trainer" } };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest(
    new Request("http://localhost/api/speelboek/drills/x", {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("/api/speelboek/drills/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isTrainer).mockResolvedValue(trainer);
    vi.mocked(isStaticDrill).mockReturnValue(false);
  });

  it("GET returns the drill or 404", async () => {
    vi.mocked(findDrill).mockResolvedValue({
      ...DRILLS[0],
      source: "static",
      published: true,
    });
    expect((await GET(req("GET"), ctx("tip-in"))).status).toBe(200);
    vi.mocked(findDrill).mockResolvedValue(null);
    expect((await GET(req("GET"), ctx("weg"))).status).toBe(404);
  });

  it("PUT refuses static drills with 409", async () => {
    vi.mocked(isStaticDrill).mockReturnValue(true);
    const res = await PUT(
      req("PUT", drillToInput(DRILLS[0], true)),
      ctx("tip-in"),
    );
    expect(res.status).toBe(409);
    expect(updateStoredDrill).not.toHaveBeenCalled();
  });

  it("PUT updates a stored drill, 404 when unknown", async () => {
    vi.mocked(updateStoredDrill).mockResolvedValue(null);
    expect(
      (await PUT(req("PUT", drillToInput(DRILLS[0], true)), ctx("weg"))).status,
    ).toBe(404);
    vi.mocked(updateStoredDrill).mockResolvedValue({
      ...DRILLS[0],
      id: "x",
      published: true,
      createdById: "t1",
      updatedAt: "2026-11-03T00:00:00.000Z",
    });
    const res = await PUT(req("PUT", drillToInput(DRILLS[0], true)), ctx("x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ drill: { id: "x" } });
  });

  it("DELETE requires a trainer and returns 204 or 404", async () => {
    vi.mocked(isTrainer).mockResolvedValue({
      isTrainer: false,
      me: { id: "p", name: "" },
    });
    expect((await DELETE(req("DELETE"), ctx("x"))).status).toBe(403);
    vi.mocked(isTrainer).mockResolvedValue(trainer);
    vi.mocked(deleteStoredDrill).mockResolvedValue(true);
    expect((await DELETE(req("DELETE"), ctx("x"))).status).toBe(204);
    vi.mocked(deleteStoredDrill).mockResolvedValue(false);
    expect((await DELETE(req("DELETE"), ctx("weg"))).status).toBe(404);
  });
});
