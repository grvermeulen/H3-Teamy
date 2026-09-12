import * as Sentry from "@sentry/nextjs";
import ical from "ical";
import type { PrismaClient } from "@prisma/client";
import { TeamEvent } from "../types";
import { canonicalEventId } from "./eventId";
import { fetchWithTimeoutAndRetries } from "./fetchWithRetry";
import { kvGetJson, kvSetJson } from "./kv";

type ParsedVEvent = {
  type?: string;
  summary?: string;
  start?: Date | string | number;
  end?: Date | string | number;
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

function icalDateToIso(value: Date | string | number): string {
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

  // Merge: new data overrides cached entries by id; cached preserves past events missing from current feed
  const map = new Map<string, TeamEvent>();
  for (const e of cached) map.set(e.id, e);
  if (parsed) {
    for (const e of parsed) map.set(e.id, e);
  }
  let merged = Array.from(map.values()).sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );

  // Prune to a bounded window so Redis does not grow without limit (asymmetric: feeds can list far-future matches).
  const now = Date.now();
  merged = merged.filter((e) => {
    const t = new Date(e.start).getTime();
    return t >= now - PRUNE_PAST_MS && t <= now + PRUNE_FUTURE_MS;
  });

  // Update cache if we had a successful parse; otherwise return cached as-is
  if (parsed) {
    await kvSetJson(cacheKey, merged).catch((error: unknown) => {
      Sentry.captureException(
        error instanceof Error ? error : new Error(String(error)),
      );
    });
  } else if (cached.length) {
    merged = cached;
  }

  // Fallback: when both iCal feed and cache are empty, load from the database
  // so historical events with RSVPs remain visible.
  if (merged.length === 0) {
    merged = await fetchEventsFromDb();
  }

  if (sportlinkFetchError && merged.length === 0) {
    Sentry.captureException(sportlinkFetchError, {
      tags: { source: "sportlink_ical" },
      fingerprint: ["sportlink-ical-fetch"],
    });
  }

  return merged;
}
