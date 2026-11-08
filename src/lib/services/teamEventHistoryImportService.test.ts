import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamEvent } from "../../types";
import {
  normalizeTeamEventsForImport,
  runTeamEventHistoryImport,
} from "./teamEventHistoryImportService";
import {
  fetchTeamEventsFromDb,
  persistTeamEventsToDb,
} from "./teamEventPersistenceService";

vi.mock("./teamEventPersistenceService", () => ({
  fetchTeamEventsFromDb: vi.fn(),
  persistTeamEventsToDb: vi.fn(),
  teamEventsNeedingDbPersist: vi.fn(
    (candidates: TeamEvent[], dbEvents: TeamEvent[]) => {
      const dbById = new Map(dbEvents.map((e) => [e.id, e]));
      return candidates.filter((e) => {
        const existing = dbById.get(e.id);
        if (!existing) return true;
        return (
          existing.start !== e.start ||
          existing.title !== e.title ||
          (existing.end ?? null) !== (e.end ?? null) ||
          (existing.description ?? null) !== (e.description ?? null)
        );
      });
    },
  ),
}));

const candidate: TeamEvent = {
  id: "20261010--ndd-h3-de-rijn-h3",
  title: "NDD H3 - De Rijn H3",
  start: "2026-10-10T16:40:00.000Z",
};

describe("teamEventHistoryImportService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("normalizeTeamEventsForImport", () => {
    it("wijst canonical id toe", () => {
      const out = normalizeTeamEventsForImport([
        {
          title: "NDD H3 - De Rijn H3",
          start: "2026-10-10T16:40:00.000Z",
        },
      ]);
      expect("events" in out).toBe(true);
      if ("events" in out) {
        expect(out.events[0].id).toBe("20261010--ndd-h3-de-rijn-h3");
      }
    });

    it("weigert een afwijkend id", () => {
      const out = normalizeTeamEventsForImport([
        {
          id: "20261010--verkeerd",
          title: "NDD H3 - De Rijn H3",
          start: "2026-10-10T16:40:00.000Z",
        },
      ]);
      expect("error" in out).toBe(true);
    });
  });

  describe("runTeamEventHistoryImport", () => {
    it("schrijft niet bij dryRun", async () => {
      vi.mocked(fetchTeamEventsFromDb).mockResolvedValue([]);
      const prisma = { event: {} } as never;

      const result = await runTeamEventHistoryImport(prisma, [candidate], true);

      expect(result.dryRun).toBe(true);
      expect(result.written).toBe(0);
      expect(result.preview[0].action).toBe("create");
      expect(persistTeamEventsToDb).not.toHaveBeenCalled();
    });

    it("persisteert alleen ontbrekende events", async () => {
      vi.mocked(fetchTeamEventsFromDb).mockResolvedValue([]);
      vi.mocked(persistTeamEventsToDb).mockResolvedValue(1);
      const prisma = { event: {} } as never;

      const result = await runTeamEventHistoryImport(
        prisma,
        [candidate],
        false,
      );

      expect(result.written).toBe(1);
      expect(persistTeamEventsToDb).toHaveBeenCalledWith(prisma, [candidate]);
    });

    it("markeert bestaande rij als unchanged", async () => {
      vi.mocked(fetchTeamEventsFromDb).mockResolvedValue([candidate]);
      const prisma = { event: {} } as never;

      const result = await runTeamEventHistoryImport(
        prisma,
        [candidate],
        false,
      );

      expect(result.preview[0].action).toBe("unchanged");
      expect(result.written).toBe(0);
      expect(persistTeamEventsToDb).not.toHaveBeenCalled();
    });
  });
});
