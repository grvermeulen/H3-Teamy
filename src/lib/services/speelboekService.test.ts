import { beforeEach, describe, expect, it, vi } from "vitest";
import { DRILLS } from "../speelboek/drills";
import {
  findDrill,
  getAllDrills,
  getCounterpart,
  isStaticDrill,
} from "./speelboekService";
import { getStoredDrill, listStoredDrills } from "./speelboekStore";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("./speelboekStore", () => ({
  listStoredDrills: vi.fn(),
  getStoredDrill: vi.fn(),
}));

const stored = {
  ...DRILLS[0],
  id: "trainer-oefening",
  title: "Trainer-oefening",
  published: false,
  createdById: "u1",
  updatedAt: "2026-11-03T00:00:00.000Z",
};

describe("speelboekService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listStoredDrills).mockResolvedValue([stored]);
    vi.mocked(getStoredDrill).mockResolvedValue(null);
  });

  it("merges stored drills in front of the static library, tagging their source", async () => {
    const all = await getAllDrills(true);
    expect(all[0]).toMatchObject({
      id: "trainer-oefening",
      source: "trainer",
      published: false,
    });
    expect(all[0]).not.toHaveProperty("createdById");
    expect(all.slice(1).map((d) => d.id)).toEqual(DRILLS.map((d) => d.id));
    expect(
      all.slice(1).every((d) => d.source === "static" && d.published),
    ).toBe(true);
    expect(listStoredDrills).toHaveBeenCalledWith(true);
  });

  it("falls back to the static library when the database fails", async () => {
    vi.mocked(listStoredDrills).mockRejectedValue(new Error("db down"));
    const all = await getAllDrills();
    expect(all.map((d) => d.id)).toEqual(DRILLS.map((d) => d.id));
  });

  it("finds static drills without touching the store, stored ones through it", async () => {
    expect((await findDrill("tip-in"))?.source).toBe("static");
    expect(getStoredDrill).not.toHaveBeenCalled();
    vi.mocked(getStoredDrill).mockResolvedValue(stored);
    expect((await findDrill("trainer-oefening"))?.source).toBe("trainer");
    vi.mocked(getStoredDrill).mockResolvedValue(null);
    expect(await findDrill("nope")).toBeNull();
    expect(isStaticDrill("tip-in")).toBe(true);
    expect(isStaticDrill("trainer-oefening")).toBe(false);
  });

  it("resolves counterparts", async () => {
    const manMeer = (await findDrill("4-2-man-meer"))!;
    expect((await getCounterpart(manMeer))?.id).toBe("zone-5-tegen-6");
    expect(await getCounterpart((await findDrill("tip-in"))!)).toBeNull();
  });
});
