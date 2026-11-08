import type { TeamEvent } from "../../types";
import { canonicalEventId } from "../eventId";
import type { TeamEventImportInput } from "../schemas/teamEventHistoryImport";
import {
  fetchTeamEventsFromDb,
  persistTeamEventsToDb,
  teamEventsNeedingDbPersist,
  type TeamEventDbClient,
} from "./teamEventPersistenceService";

export type TeamEventImportAction = "create" | "update" | "unchanged";

export type TeamEventImportPreviewRow = {
  id: string;
  title: string;
  start: string;
  action: TeamEventImportAction;
  existingTitle?: string;
  existingStart?: string;
};

export type TeamEventHistoryImportResult = {
  dryRun: boolean;
  preview: TeamEventImportPreviewRow[];
  written: number;
  events: TeamEvent[];
};

/**
 * Valideert invoer en koppelt altijd het canonical event-id (geen vrije aliassen).
 */
export function normalizeTeamEventsForImport(
  inputs: TeamEventImportInput[],
): { events: TeamEvent[] } | { error: string } {
  const events: TeamEvent[] = [];
  for (const input of inputs) {
    const expectedId = canonicalEventId(input.title, input.start);
    if (input.id && input.id !== expectedId) {
      return {
        error: `id_komt_niet_overeen_met_canonical: verwacht ${expectedId}, kreeg ${input.id}`,
      };
    }
    events.push({
      id: expectedId,
      title: input.title.trim(),
      start: input.start,
      end: input.end,
      location: input.location,
      description: input.description,
      uid: input.uid,
    });
  }
  return { events };
}

function buildPreview(
  candidates: TeamEvent[],
  dbEvents: TeamEvent[],
): TeamEventImportPreviewRow[] {
  const dbById = new Map(dbEvents.map((e) => [e.id, e]));
  const needing = new Set(
    teamEventsNeedingDbPersist(candidates, dbEvents).map((e) => e.id),
  );

  return candidates.map((c) => {
    const existing = dbById.get(c.id);
    if (!existing) {
      return {
        id: c.id,
        title: c.title,
        start: c.start,
        action: "create",
      };
    }
    if (needing.has(c.id)) {
      return {
        id: c.id,
        title: c.title,
        start: c.start,
        action: "update",
        existingTitle: existing.title,
        existingStart: existing.start,
      };
    }
    return {
      id: c.id,
      title: c.title,
      start: c.start,
      action: "unchanged",
      existingTitle: existing.title,
      existingStart: existing.start,
    };
  });
}

/**
 * Idempotente preview of uitvoering: upsert alleen rijen die ontbreken of afwijken.
 */
export async function runTeamEventHistoryImport(
  prisma: TeamEventDbClient,
  candidates: TeamEvent[],
  dryRun: boolean,
): Promise<TeamEventHistoryImportResult> {
  const dbEvents = await fetchTeamEventsFromDb(prisma);
  const preview = buildPreview(candidates, dbEvents);
  const toWrite = teamEventsNeedingDbPersist(candidates, dbEvents);

  if (dryRun || toWrite.length === 0) {
    return {
      dryRun,
      preview,
      written: 0,
      events: candidates,
    };
  }

  const written = await persistTeamEventsToDb(prisma, toWrite);
  return {
    dryRun: false,
    preview,
    written,
    events: candidates,
  };
}
