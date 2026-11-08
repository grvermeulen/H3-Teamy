import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "../../../../../lib/db";
import { withDbRequestMetrics } from "../../../../../lib/dbMetrics";
import {
  teamEventsForImportPreset,
  TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026,
  type TeamEventImportPresetId,
} from "../../../../../lib/knzbVerifiedH3Gap2026";
import {
  TeamEventHistoryImportBodySchema,
  TeamEventImportPresetSchema,
} from "../../../../../lib/schemas/teamEventHistoryImport";
import {
  normalizeTeamEventsForImport,
  runTeamEventHistoryImport,
} from "../../../../../lib/services/teamEventHistoryImportService";
import { isAdminUser } from "../../../../../lib/trainer";

function resolvePreset(preset: TeamEventImportPresetId) {
  return teamEventsForImportPreset(preset);
}

/**
 * GET: droge run voor een bekende preset (geen database-writes).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return withDbRequestMetrics("api/admin/team-events/import.GET", async () => {
    const { isAdmin } = await isAdminUser(req);
    if (!isAdmin) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const presetRaw = req.nextUrl.searchParams.get("preset");
    const parsedPreset = TeamEventImportPresetSchema.safeParse(presetRaw);
    if (!parsedPreset.success) {
      return NextResponse.json(
        {
          error: "invalid_preset",
          message: `Gebruik preset=${TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026}`,
        },
        { status: 400 },
      );
    }

    try {
      const candidates = resolvePreset(parsedPreset.data);
      const result = await runTeamEventHistoryImport(prisma, candidates, true);
      return NextResponse.json(result);
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { area: "admin", kind: "team-event-import-preview" },
      });
      return NextResponse.json(
        { error: "import_mislukt", message: "Voorbeeld importeren mislukt." },
        { status: 500 },
      );
    }
  });
}

/**
 * POST: idempotente geschiedenis-import naar `Event` (alleen admin).
 * Standaard `dryRun: true`; zet `dryRun: false` om daadwerkelijk te schrijven.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return withDbRequestMetrics("api/admin/team-events/import.POST", async () => {
    const { isAdmin } = await isAdminUser(req);
    if (!isAdmin) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { area: "admin", kind: "team-event-import-json" },
      });
      return NextResponse.json(
        { error: "invalid_json", message: "Ongeldige JSON-invoer." },
        { status: 400 },
      );
    }

    const parsed = TeamEventHistoryImportBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "invalid_payload",
          message: "Ongeldige invoer voor wedstrijdimport.",
          details: parsed.error.issues,
        },
        { status: 400 },
      );
    }

    const { dryRun, preset, events: rawEvents } = parsed.data;

    let candidates;
    if (preset) {
      candidates = resolvePreset(preset);
    } else if (rawEvents) {
      const normalized = normalizeTeamEventsForImport(rawEvents);
      if ("error" in normalized) {
        return NextResponse.json(
          {
            error: "invalid_event",
            message: normalized.error,
          },
          { status: 400 },
        );
      }
      candidates = normalized.events;
    } else {
      return NextResponse.json(
        { error: "invalid_payload", message: "Geef preset of events op." },
        { status: 400 },
      );
    }

    try {
      const result = await runTeamEventHistoryImport(
        prisma,
        candidates,
        dryRun,
      );
      return NextResponse.json(result);
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { area: "admin", kind: "team-event-import" },
        extra: { dryRun, preset: preset ?? null },
      });
      return NextResponse.json(
        { error: "import_mislukt", message: "Wedstrijdimport mislukt." },
        { status: 500 },
      );
    }
  });
}
