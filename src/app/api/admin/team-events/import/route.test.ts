import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { GET, POST } from "./route";
import { isAdminUser } from "@/lib/trainer";
import { runTeamEventHistoryImport } from "@/lib/services/teamEventHistoryImportService";
import { TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026 } from "@/lib/knzbVerifiedH3Gap2026";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/trainer", () => ({
  isAdminUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {},
}));

vi.mock("@/lib/dbMetrics", () => ({
  withDbRequestMetrics: (_name: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/lib/services/teamEventHistoryImportService", () => ({
  normalizeTeamEventsForImport: vi.fn(),
  runTeamEventHistoryImport: vi.fn(),
}));

const ADMIN = { isAdmin: true, me: { id: "admin-1", name: "Admin" } };
const NON_ADMIN = { isAdmin: false, me: { id: "", name: "" } };

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(url, init));
}

describe("admin team-events import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("returns 403 for a non-admin", async () => {
      vi.mocked(isAdminUser).mockResolvedValue(NON_ADMIN);

      const response = await GET(
        makeRequest(
          `http://localhost/api/admin/team-events/import?preset=${TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026}`,
        ),
      );

      expect(response.status).toBe(403);
    });

    it("returns dry-run preview for admin preset", async () => {
      vi.mocked(isAdminUser).mockResolvedValue(ADMIN);
      vi.mocked(runTeamEventHistoryImport).mockResolvedValue({
        dryRun: true,
        preview: [],
        written: 0,
        events: [],
      });

      const response = await GET(
        makeRequest(
          `http://localhost/api/admin/team-events/import?preset=${TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026}`,
        ),
      );

      expect(response.status).toBe(200);
      expect(runTeamEventHistoryImport).toHaveBeenCalledWith(
        {},
        expect.any(Array),
        true,
      );
    });
  });

  describe("POST", () => {
    it("defaults to dryRun and uses preset", async () => {
      vi.mocked(isAdminUser).mockResolvedValue(ADMIN);
      vi.mocked(runTeamEventHistoryImport).mockResolvedValue({
        dryRun: true,
        preview: [{ id: "x", title: "t", start: "s", action: "create" }],
        written: 0,
        events: [],
      });

      const response = await POST(
        makeRequest("http://localhost/api/admin/team-events/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            preset: TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026,
          }),
        }),
      );

      expect(response.status).toBe(200);
      expect(runTeamEventHistoryImport).toHaveBeenCalledWith(
        {},
        expect.arrayContaining([
          expect.objectContaining({ id: "20261010--ndd-h3-de-rijn-h3" }),
        ]),
        true,
      );
    });

    it("captures unexpected errors", async () => {
      vi.mocked(isAdminUser).mockResolvedValue(ADMIN);
      vi.mocked(runTeamEventHistoryImport).mockRejectedValue(new Error("db"));

      const response = await POST(
        makeRequest("http://localhost/api/admin/team-events/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            preset: TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026,
            dryRun: false,
          }),
        }),
      );

      expect(response.status).toBe(500);
      expect(Sentry.captureException).toHaveBeenCalled();
    });
  });
});
