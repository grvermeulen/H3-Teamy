import { beforeEach, describe, expect, it, vi } from "vitest";
import { DRILLS } from "../speelboek/drills";
import {
  buildProgramMessage,
  getProgram,
  getUpcomingProgram,
  setProgram,
  shareProgram,
} from "./trainingProgramService";
import { getAllDrills } from "./speelboekService";
import { getStoredDrill } from "./speelboekStore";
import { getWaapiAppUrl, sendWhatsAppGroupMessage } from "./waapiService";

const { db } = vi.hoisted(() => ({
  db: {
    trainingProgramItem: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../db", () => ({ prisma: db }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("./speelboekStore", () => ({
  listStoredDrills: vi.fn().mockResolvedValue([]),
  getStoredDrill: vi.fn().mockResolvedValue(null),
}));
vi.mock("./speelboekService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./speelboekService")>();
  return {
    ...actual,
    getAllDrills: vi.fn(actual.getAllDrills),
  };
});
vi.mock("./waapiService", () => ({
  sendWhatsAppGroupMessage: vi.fn(),
  getWaapiAppUrl: vi.fn(),
}));

const row = (drillId: string, position: number) => ({
  id: `row-${position}`,
  drillId,
  position,
  minutes: 10,
  note: null,
});

describe("trainingProgramService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockResolvedValue([]);
  });

  it("resolves programme rows to drills, keeping unknown ids as null", async () => {
    db.trainingProgramItem.findMany.mockResolvedValue([
      row("tip-in", 0),
      row("weg", 1),
    ]);
    const program = await getProgram("2026-11-04");
    expect(program.items[0].drill?.title).toBe("Tip-in");
    expect(program.items[1].drill).toBeNull();
  });

  it("rejects programmes with unknown or duplicate drills", async () => {
    expect(await setProgram("2026-11-04", [{ drillId: "nope" }])).toBeNull();
    expect(
      await setProgram("2026-11-04", [
        { drillId: "tip-in" },
        { drillId: "tip-in" },
      ]),
    ).toBeNull();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("replaces the programme in one transaction with positions in order", async () => {
    db.trainingProgramItem.findMany.mockResolvedValue([row("tip-in", 0)]);
    await setProgram("2026-11-04", [
      { drillId: "4-2-man-meer", minutes: 15 },
      { drillId: "tip-in", note: "" },
    ]);
    expect(db.trainingProgramItem.deleteMany).toHaveBeenCalledWith({
      where: { date: "2026-11-04" },
    });
    expect(db.trainingProgramItem.createMany).toHaveBeenCalledWith({
      data: [
        {
          date: "2026-11-04",
          drillId: "4-2-man-meer",
          position: 0,
          minutes: 15,
          note: null,
        },
        {
          date: "2026-11-04",
          drillId: "tip-in",
          position: 1,
          minutes: null,
          note: null,
        },
      ],
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("finds the next planned training within the window", async () => {
    db.trainingProgramItem.findMany
      .mockResolvedValueOnce([{ date: "2026-11-05" }])
      .mockResolvedValueOnce([
        {
          ...row("tip-in", 0),
          date: "2026-11-05",
        },
      ]);
    const program = await getUpcomingProgram(new Date("2026-11-03T10:00:00"));
    expect(program?.date).toBe("2026-11-05");
    expect(db.trainingProgramItem.findMany).toHaveBeenCalledTimes(2);
    expect(db.trainingProgramItem.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { date: { in: ["2026-11-05"] } },
      }),
    );
    db.trainingProgramItem.findMany.mockResolvedValueOnce([]);
    expect(await getUpcomingProgram()).toBeNull();
  });

  it("validates programme drills with one library load (no per-id DB lookups)", async () => {
    db.trainingProgramItem.findMany.mockResolvedValue([row("tip-in", 0)]);
    await setProgram("2026-11-04", [
      { drillId: "tip-in" },
      { drillId: "4-2-man-meer" },
    ]);
    expect(vi.mocked(getAllDrills)).toHaveBeenCalled();
    expect(vi.mocked(getStoredDrill)).not.toHaveBeenCalled();
  });

  it("builds a WhatsApp message with deep links", () => {
    const message = buildProgramMessage(
      {
        date: "2026-11-05",
        items: [
          {
            ...row("tip-in", 0),
            drill: DRILLS.find((d) => d.id === "tip-in")!,
          },
          { ...row("weg", 1), drill: null },
        ],
      },
      "https://h3.example",
      "woensdag",
    );
    expect(message).toBe(
      [
        "Training woensdag: dit gaan we oefenen",
        "• Tip-in (10 min) – https://h3.example/speelboek/tip-in",
        "",
        "Bekijk alles in het speelboek: https://h3.example/speelboek",
      ].join("\n"),
    );
  });

  it("shares the programme, refusing empty ones or missing config", async () => {
    db.trainingProgramItem.findMany.mockResolvedValue([]);
    expect(await shareProgram("2026-11-05", "woensdag")).toMatchObject({
      sent: false,
      details: "empty_program",
    });

    db.trainingProgramItem.findMany.mockResolvedValue([row("tip-in", 0)]);
    vi.mocked(getWaapiAppUrl).mockReturnValue(null);
    expect(await shareProgram("2026-11-05", "woensdag")).toEqual({
      sent: false,
      reason: "missing_config",
    });

    vi.mocked(getWaapiAppUrl).mockReturnValue("https://h3.example");
    vi.mocked(sendWhatsAppGroupMessage).mockResolvedValue({ sent: true });
    expect(await shareProgram("2026-11-05", "woensdag")).toEqual({
      sent: true,
    });
    expect(sendWhatsAppGroupMessage).toHaveBeenCalledWith(
      expect.stringContaining("https://h3.example/speelboek/tip-in"),
    );
  });
});
