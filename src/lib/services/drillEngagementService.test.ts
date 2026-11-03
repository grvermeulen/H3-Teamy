import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ackCountsByDrill,
  askDrillQuestion,
  getDrillEngagement,
  listAckedDrillIds,
  resolveDrillQuestion,
  setDrillAck,
} from "./drillEngagementService";

const { db } = vi.hoisted(() => ({
  db: {
    drillAck: {
      count: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    drillQuestion: {
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("../db", () => ({ prisma: db }));

const question = {
  id: "q1",
  text: "Wat als 2 niet vrij is?",
  createdAt: new Date("2026-11-03T10:00:00Z"),
  resolvedAt: null,
  userId: "u2",
  user: { firstName: "Henry", lastName: "T" },
};

describe("drillEngagementService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.drillAck.count.mockResolvedValue(3);
    db.drillQuestion.findMany.mockResolvedValue([question]);
  });

  it("shows players only their own questions, without asker names", async () => {
    db.drillAck.findUnique.mockResolvedValue({ id: "a1" });
    const result = await getDrillEngagement("tip-in", "u2", false);
    expect(result).toMatchObject({ ackCount: 3, acked: true });
    expect(result.questions[0]).toMatchObject({ askedBy: null, mine: true });
    expect(db.drillQuestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { drillId: "tip-in", userId: "u2" } }),
    );
  });

  it("shows trainers every question with the asker's name", async () => {
    db.drillAck.findUnique.mockResolvedValue(null);
    const result = await getDrillEngagement("tip-in", "u1", true);
    expect(result.acked).toBe(false);
    expect(result.questions[0]).toMatchObject({
      askedBy: "Henry T",
      mine: false,
    });
    expect(db.drillQuestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { drillId: "tip-in" } }),
    );
  });

  it("anonymous viewers get the count but no ack or questions", async () => {
    db.drillQuestion.findMany.mockResolvedValue([]);
    const result = await getDrillEngagement("tip-in", null, false);
    expect(result).toEqual({ ackCount: 3, acked: false, questions: [] });
    expect(db.drillAck.findUnique).not.toHaveBeenCalled();
  });

  it("sets and clears acks and returns the new count", async () => {
    expect(await setDrillAck("tip-in", "u2", true)).toBe(3);
    expect(db.drillAck.upsert).toHaveBeenCalled();
    await setDrillAck("tip-in", "u2", false);
    expect(db.drillAck.deleteMany).toHaveBeenCalledWith({
      where: { drillId: "tip-in", userId: "u2" },
    });
  });

  it("lists acked ids and counts per drill", async () => {
    db.drillAck.findMany.mockResolvedValue([{ drillId: "tip-in" }]);
    expect(await listAckedDrillIds("u2")).toEqual(["tip-in"]);
    db.drillAck.groupBy.mockResolvedValue([
      { drillId: "tip-in", _count: { _all: 4 } },
    ]);
    expect(await ackCountsByDrill(["tip-in"])).toEqual({ "tip-in": 4 });
    expect(await ackCountsByDrill([])).toEqual({});
  });

  it("stores and resolves questions", async () => {
    db.drillQuestion.create.mockResolvedValue({
      id: "q2",
      text: "Hoe?",
      createdAt: new Date("2026-11-03T11:00:00Z"),
    });
    expect(await askDrillQuestion("tip-in", "u2", "Hoe?")).toMatchObject({
      id: "q2",
      mine: true,
      resolvedAt: null,
    });
    db.drillQuestion.updateMany.mockResolvedValue({ count: 1 });
    expect(await resolveDrillQuestion("tip-in", "q2")).toBe(true);
    db.drillQuestion.updateMany.mockResolvedValue({ count: 0 });
    expect(await resolveDrillQuestion("tip-in", "andere")).toBe(false);
  });
});
