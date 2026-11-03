import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { DRILLS } from "../speelboek/drills";
import { drillToInput } from "../speelboek/editor";
import {
  createStoredDrill,
  deleteStoredDrill,
  getStoredDrill,
  listStoredDrills,
  uniqueDrillSlug,
  updateStoredDrill,
} from "./speelboekStore";

const { db } = vi.hoisted(() => ({
  db: {
    speelboekDrill: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    drillAck: { deleteMany: vi.fn() },
    drillQuestion: { deleteMany: vi.fn() },
    trainingProgramItem: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../db", () => ({ prisma: db }));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const content = DRILLS.find((d) => d.id === "tip-in")!;
const now = new Date("2026-11-03T12:00:00Z");

describe("speelboekStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.speelboekDrill.findMany.mockResolvedValue([]);
  });

  it("parses rows and skips invalid content with a Sentry message", async () => {
    db.speelboekDrill.findMany.mockResolvedValue([
      { id: "ok", content, published: true, createdById: "u1", updatedAt: now },
      {
        id: "kapot",
        content: { title: 1 },
        published: true,
        createdById: null,
        updatedAt: now,
      },
    ]);
    const drills = await listStoredDrills();
    expect(drills.map((d) => d.id)).toEqual(["ok"]);
    expect(drills[0]).toMatchObject({
      published: true,
      updatedAt: now.toISOString(),
    });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(db.speelboekDrill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { published: true } }),
    );
    await listStoredDrills(true);
    expect(db.speelboekDrill.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });

  it("picks a slug that avoids static and stored drills", async () => {
    expect(await uniqueDrillSlug("Tip-in")).toBe("tip-in-2");
    db.speelboekDrill.findMany.mockResolvedValue([
      { id: "hoekschot" },
      { id: "hoekschot-2" },
    ]);
    expect(await uniqueDrillSlug("Hoekschot!")).toBe("hoekschot-3");
    expect(await uniqueDrillSlug("***")).toBe("oefening");
  });

  it("creates a drill with today's date and the trainer as author", async () => {
    db.speelboekDrill.create.mockResolvedValue({ updatedAt: now });
    const input = { ...drillToInput(content, false), title: "Nieuwe tip-in" };
    const drill = await createStoredDrill(input, "u1");
    expect(drill).toMatchObject({
      id: "nieuwe-tip-in",
      title: "Nieuwe tip-in",
      published: false,
      createdById: "u1",
    });
    expect(drill.addedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(drill).not.toHaveProperty("published", undefined);
    const data = db.speelboekDrill.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      id: "nieuwe-tip-in",
      category: "TECHNIEK",
      published: false,
    });
    expect(data.content).not.toHaveProperty("published");
  });

  it("updates an existing drill keeping id and addedOn, or returns null", async () => {
    db.speelboekDrill.findUnique.mockResolvedValue(null);
    expect(
      await updateStoredDrill("weg", drillToInput(content, true)),
    ).toBeNull();

    db.speelboekDrill.findUnique.mockResolvedValue({
      id: "bestaand",
      content: { ...content, id: "bestaand", addedOn: "2026-01-01" },
      published: false,
      createdById: "u1",
      updatedAt: now,
    });
    db.speelboekDrill.update.mockResolvedValue({ updatedAt: now });
    const updated = await updateStoredDrill("bestaand", {
      ...drillToInput(content, true),
      title: "Anders",
    });
    expect(updated).toMatchObject({
      id: "bestaand",
      addedOn: "2026-01-01",
      title: "Anders",
      published: true,
      createdById: "u1",
    });
  });

  it("deletes a drill with its acks, questions and programme items", async () => {
    db.speelboekDrill.findUnique.mockResolvedValue(null);
    expect(await deleteStoredDrill("weg")).toBe(false);
    db.speelboekDrill.findUnique.mockResolvedValue({ id: "x" });
    expect(await deleteStoredDrill("x")).toBe(true);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.drillAck.deleteMany).toHaveBeenCalledWith({
      where: { drillId: "x" },
    });
    expect(db.trainingProgramItem.deleteMany).toHaveBeenCalledWith({
      where: { drillId: "x" },
    });
    expect(db.speelboekDrill.delete).toHaveBeenCalledWith({
      where: { id: "x" },
    });
  });

  it("gets one drill", async () => {
    db.speelboekDrill.findUnique.mockResolvedValue({
      id: "tip-in-2",
      content: { ...content, id: "tip-in-2" },
      published: true,
      createdById: null,
      updatedAt: now,
    });
    expect((await getStoredDrill("tip-in-2"))?.id).toBe("tip-in-2");
  });
});
