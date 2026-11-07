import * as Sentry from "@sentry/nextjs";
import ical from "ical";
import { TZDateMini } from "@date-fns/tz";
import type { PrismaClient } from "@prisma/client";
import { TeamEvent } from "../types";
import { canonicalEventId } from "./eventId";
import { fetchWithTimeoutAndRetries } from "./fetchWithRetry";
import { kvGetJson, kvSetJson } from "./kv";

type IcalDate = Date & { tz?: string };

type ParsedVEvent = {
  type?: string;
  summary?: string;
  start?: IcalDate | string | number;
  end?: IcalDate | string | number;
  uid?: string;
  location?: string;
  description?: string;
};

/** Past events kept for RSVP/history (Sportlink + buffer). */
const PRUNE_PAST_MS = 400 * 24 * 60 * 60 * 1000;
/** Future events kept — Sportlink feeds often list the next full season (>365 days). */
const PRUNE_FUTURE_MS = 540 * 24 * 60 * 60 * 1000;

let dbLoaded = false;
let prisma: PrismaClient | null = null;
async function getLazyPrisma(): Promise<PrismaClient | null> {
  if (dbLoaded) return prisma;
  if (!process.env.DATABASE_URL && !process.env.PRISMA_DATABASE_URL) {
    dbLoaded = true;
    prisma = null;
    return null;
  }
  const mod = await import("./db");
  prisma = mod.prisma;
  dbLoaded = true;
  return prisma;
}

/**
 * Merges team event lists. Feed data wins by id; also reconciles uid when Sportlink
 * ids drift after timezone fixes.
 */
export function mergeTeamEventLists(
  ...sources: Array<TeamEvent[] | null | undefined>
): TeamEvent[] {
  const byId = new Map<string, TeamEvent>();
  const idByUid = new Map<string, string>();

  for (const source of sources) {
    if (!source?.length) continue;
    for (const raw of source) {
      let targetId = raw.id;
      if (raw.uid && idByUid.has(raw.uid)) {
        targetId = idByUid.get(raw.uid)!;
      }
      const prev = byId.get(targetId);
      const merged: TeamEvent = { ...prev, ...raw, id: targetId };
      byId.set(targetId, merged);
      if (merged.uid) idByUid.set(merged.uid, targetId);
      if (prev?.uid && !merged.uid) idByUid.set(prev.uid, targetId);
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
}

function pruneTeamEventsByStartWindow(
  events: TeamEvent[],
  nowMs: number,
): TeamEvent[] {
  return events.filter((e) => {
    const t = new Date(e.start).getTime();
    return t >= nowMs - PRUNE_PAST_MS && t <= nowMs + PRUNE_FUTURE_MS;
  });
}

/**
 * Best-effort Postgres copy of merged calendar metadata for history when
 * Sportlink drops past VEVENTs from the live feed.
 */
async function persistTeamEventsToDb(events: TeamEvent[]): Promise<void> {
  const p = await getLazyPrisma();
  if (!p || events.length === 0) return;
  await Promise.all(
    events.map((e) =>
      p.event.upsert({
        where: { id: e.id },
        create: {
          id: e.id,
          title: e.title,
          description: e.description ?? null,
          startDate: new Date(e.start),
          endDate: e.end ? new Date(e.end) : null,
        },
        update: {
          title: e.title,
          description: e.description ?? null,
          startDate: new Date(e.start),
          endDate: e.end ? new Date(e.end) : null,
        },
      }),
    ),
  );
}

/**
 * Loads historical events from the database when the iCal feed and cache are
 * both empty. Only returns events that have a title and startDate populated.
 */
async function fetchEventsFromDb(): Promise<TeamEvent[]> {
  try {
    const p = await getLazyPrisma();
    if (!p) return [];
    const rows = await p.event.findMany({
      where: { title: { not: null }, startDate: { not: null } },
      orderBy: { startDate: "asc" },
    });
    return rows
      .filter((r) => r.title && r.startDate)
      .map((r) => ({
        id: r.id,
        title: r.title!,
        start: r.startDate!.toISOString(),
        end: r.endDate?.toISOString(),
        description: r.description ?? undefined,
      }));
  } catch (err: unknown) {
    Sentry.captureException(
      err instanceof Error ? err : new Error(String(err)),
      { tags: { source: "event_db_fallback" } },
    );
    return [];
  }
}

function icalDateToIso(value: IcalDate | string | number): string {
  if (value instanceof Date && value.tz) {
    // `ical` stores TZID wall-clock fields in a server-local Date without converting them.
    return new TZDateMini(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
      value.getMilliseconds(),
      value.tz,
    ).toISOString();
  }
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString();
}

/**
 * Fetches, parses, and caches team events from the external iCal feed.
 * Uses the `ical` package for parsing (not `node-ical`) so the SSR bundle avoids `rrule-temporal` / `@js-temporal/polyfill` / `jsbi`, which can break under Next.js Turbopack (`BigInt is not a function` on the polyfill).
 * Merges new data with existing cached data to preserve history.
 * Events outside a bounded window (roughly 400 days past through 540 days future) are dropped when updating the cache.
 * The Sportlink HTTP request uses a bounded timeout and a few retries so transient `ETIMEDOUT` spikes do not fail the page or spam Sentry on every retry.
 *
 * @returns A list of {@link TeamEvent} objects sorted by date.
 */
export async function fetchTeamEvents(): Promise<TeamEvent[]> {
  const url = process.env.SPORTLINK_ICAL_URL;

  const cacheKey = "calendar:events:v1";
  let parsed: TeamEvent[] | null = null;
  let sportlinkFetchError: Error | null = null;

  if (url) {
    try {
      const res = await fetchWithTimeoutAndRetries(url, {
        cache: "no-store",
        timeoutMs: 12_000,
        maxAttempts: 3,
      });
      if (!res.ok) throw new Error(`Failed to fetch iCal: ${res.status}`);
      const text = await res.text();
      const data = ical.parseICS(text) as Record<string, ParsedVEvent>;
      parsed = Object.values(data)
        .filter((c): c is ParsedVEvent => c?.type === "VEVENT")
        .map((evt) => {
          const title = (evt.summary || "Match").toString();
          if (evt.start === undefined) {
            throw new Error("VEVENT without DTSTART");
          }
          const startIso = icalDateToIso(evt.start);
          const id = canonicalEventId(title, startIso);
          return {
            id,
            uid: evt.uid?.toString(),
            title,
            start: startIso,
            end: evt.end !== undefined ? icalDateToIso(evt.end) : undefined,
            location: evt.location?.toString(),
            description: evt.description?.toString(),
          } satisfies TeamEvent;
        });
    } catch (err: unknown) {
      sportlinkFetchError = err instanceof Error ? err : new Error(String(err));
    }
  }

  const cached = (await kvGetJson<TeamEvent[]>(cacheKey)) || [];
  const dbEvents = await fetchEventsFromDb();

  // Sportlink feed is future-only; KV + Postgres keep past matches for RSVP/verslagen.
  const now = Date.now();
  let merged = mergeTeamEventLists(cached, parsed ?? undefined, dbEvents);

  if (parsed) {
    merged = pruneTeamEventsByStartWindow(merged, now);
    await kvSetJson(cacheKey, merged).catch((error: unknown) => {
      Sentry.captureException(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
    void persistTeamEventsToDb(merged).catch((error: unknown) => {
      Sentry.captureException(
        error instanceof Error ? error : new Error(String(error)),
        { tags: { source: "event_db_persist" } },
      );
    });
  }

  if (sportlinkFetchError && merged.length === 0) {
    Sentry.captureException(sportlinkFetchError, {
      tags: { source: "sportlink_ical" },
      fingerprint: ["sportlink-ical-fetch"],
    });
  }

  return merged;
}
