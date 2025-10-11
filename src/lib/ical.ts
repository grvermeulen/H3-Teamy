import ical, { CalendarComponent } from "node-ical";
import { TeamEvent } from "../types";
import { canonicalEventId } from "./eventId";
import { getRedis } from "./kv";
import * as Sentry from "@sentry/nextjs";

const EVENTS_CACHE_KEY = "events:team";
const EVENTS_CACHE_TTL = 60 * 60; // 1 hour - sports schedules don't change frequently

export async function fetchTeamEvents(): Promise<TeamEvent[]> {
  return Sentry.startSpan(
    {
      op: "http.client",
      name: "Fetch Team Events from Sportlink iCal",
    },
    async (span) => {
      const url = process.env.SPORTLINK_ICAL_URL;
      if (!url) {
        throw new Error("SPORTLINK_ICAL_URL environment variable is not set");
      }

      span.setAttribute("url", url);

      const redis = await getRedis();
      if (redis) {
        // Try to get cached events first
        const cachedEvents = await redis.get(EVENTS_CACHE_KEY);
        if (cachedEvents) {
          try {
            const parsed = JSON.parse(cachedEvents);
            // Check if cache is still fresh (within TTL)
            if (Date.now() - parsed.timestamp < EVENTS_CACHE_TTL * 1000) {
              span.setAttribute("cache.hit", true);
              return parsed.events;
            }
          } catch (error) {
            // Cache parsing failed, continue to fetch fresh data
            console.warn("Failed to parse cached events:", error);
            Sentry.captureException(error, {
              tags: { function: "fetchTeamEvents", error_type: "cache_parse_error" }
            });
          }
        }
      }

      // Fetch fresh data from external source
      const fetchStart = Date.now();
      const res = await fetch(url);
      const fetchDuration = Date.now() - fetchStart;

      span.setAttribute("http.status_code", res.status);
      span.setAttribute("http.duration_ms", fetchDuration);

      if (!res.ok) {
        // If fetch fails and we have cached data, return it as fallback
        if (redis) {
          const cachedEvents = await redis.get(EVENTS_CACHE_KEY);
          if (cachedEvents) {
            try {
              const parsed = JSON.parse(cachedEvents);
              console.warn("Using stale cached events due to fetch failure");
              span.setAttribute("fallback_to_cache", true);
              return parsed.events;
            } catch (error) {
              console.error("Cached events also corrupted:", error);
              Sentry.captureException(error, {
                tags: { function: "fetchTeamEvents", error_type: "cache_corrupted" }
              });
            }
          }
        }
        throw new Error(`Failed to fetch iCal: ${res.status}`);
      }

      const text = await res.text();
      const data = ical.parseICS(text);

      const events: TeamEvent[] = Object.values(data)
        .filter((c): c is CalendarComponent & { type: "VEVENT" } => c?.type === "VEVENT")
        .map((evt) => {
          const title = (evt.summary || "Match").toString();
          const startIso = evt.start instanceof Date ? evt.start.toISOString() : new Date(evt.start as any).toISOString();
          const id = canonicalEventId(title, startIso);
          return {
            id,
            uid: evt.uid?.toString(),
            title,
            start: startIso,
            end: evt.end ? (evt.end instanceof Date ? evt.end.toISOString() : new Date(evt.end as any).toISOString()) : undefined,
            location: evt.location?.toString(),
            description: evt.description?.toString(),
          } satisfies TeamEvent;
        })
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

      span.setAttribute("events_count", events.length);

      // Cache the events if Redis is available
      if (redis) {
        try {
          await redis.setex(EVENTS_CACHE_KEY, EVENTS_CACHE_TTL, JSON.stringify({
            events,
            timestamp: Date.now()
          }));
          span.setAttribute("cache.set", true);
        } catch (error) {
          console.warn("Failed to cache events:", error);
          Sentry.captureException(error, {
            tags: { function: "fetchTeamEvents", error_type: "cache_set_error" }
          });
        }
      }

      return events;
    }
  );
}


