import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import type { TeamEvent } from "../../types";
import {
  fetchTeamEventsFromDb,
  isPersistableTeamEvent,
  persistTeamEventsToDb,
  teamEventsNeedingDbPersist,
} from "./teamEventPersistenceService";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

const dbEvents: TeamEvent[] = [
  {
    id: "20261107--thuis",
    title: "De Rijn H3-Opponent",
    start: "2026-11-07T17:50:00.000Z",
    end: "2026-11-07T19:50:00.000Z",
  },
];

describe("teamEventPersistenceService", () => {
  const findMany = vi.fn();
  const executeRaw = vi.fn().mockResolvedValue(1);
  const prisma = { event: { findMany }, $executeRaw: executeRaw };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isPersistableTeamEvent", () => {
    it("requires title and start", () => {
      expect(
        isPersistableTeamEvent({
          id: "x",
          title: "Wedstrijd",
          start: "2026-11-07T12:00:00.000Z",
        }),
      ).toBe(true);
      expect(
        isPersistableTeamEvent({
          id: "stub",
          title: "",
          start: "2026-11-07T12:00:00.000Z",
        }),
      ).toBe(false);
    });
  });

  describe("teamEventsNeedingDbPersist", () => {
    it("flags missing ids and metadata updates", () => {
      const cached: TeamEvent[] = [
        ...dbEvents,
        {
          id: "20261031--away",
          title: "Away",
          start: "2026-10-31T17:50:00.000Z",
        },
        {
          id: "20261107--thuis",
          title: "De Rijn H3-Opponent",
          start: "2026-11-07T18:50:00.000Z",
        },
      ];
      const needs = teamEventsNeedingDbPersist(cached, dbEvents);
      expect(needs.map((e) => e.id)).toEqual([
        "20261031--away",
        "20261107--thuis",
      ]);
    });

    it("skips RSVP stubs without metadata", () => {
      const needs = teamEventsNeedingDbPersist(
        [{ id: "rsvp-only", title: "", start: "" }],
        [],
      );
      expect(needs).toHaveLength(0);
    });
  });

  describe("persistTeamEventsToDb", () => {
    it("bulk-upserts complete metadata in one query and returns the write count", async () => {
      const written = await persistTeamEventsToDb(prisma, dbEvents);
      expect(written).toBe(1);
      expect(executeRaw).toHaveBeenCalledTimes(1);
    });

    it("uses a single query for many events (no N+1 upserts)", async () => {
      const many: TeamEvent[] = Array.from({ length: 12 }, (_, i) => ({
        id: `2026110${i}--thuis`,
        title: `Wedstrijd ${i}`,
        start: "2026-11-07T17:50:00.000Z",
      }));
      const written = await persistTeamEventsToDb(prisma, many);
      expect(written).toBe(12);
      expect(executeRaw).toHaveBeenCalledTimes(1);
    });

    it("skips empty candidate lists", async () => {
      const written = await persistTeamEventsToDb(prisma, []);
      expect(written).toBe(0);
      expect(executeRaw).not.toHaveBeenCalled();
    });
  });

  describe("fetchTeamEventsFromDb", () => {
    it("maps rows with startDate into TeamEvent objects", async () => {
      findMany.mockResolvedValue([
        {
          id: "20261107--thuis",
          title: "Thuis",
          description: null,
          startDate: new Date("2026-11-07T17:50:00.000Z"),
          endDate: new Date("2026-11-07T19:50:00.000Z"),
        },
        { id: "stub", title: null, startDate: null, endDate: null },
      ]);
      const rows = await fetchTeamEventsFromDb(prisma);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: "20261107--thuis",
        start: "2026-11-07T17:50:00.000Z",
      });
    });

    it("reports Prisma failures and returns an empty list", async () => {
      findMany.mockRejectedValue(new Error("db down"));
      const rows = await fetchTeamEventsFromDb(prisma);
      expect(rows).toEqual([]);
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ tags: { source: "event_db_fallback" } }),
      );
    });
  });
});
