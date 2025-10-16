import ical, { CalendarComponent } from "node-ical";
import { TeamEvent } from "../types";
import { canonicalEventId } from "./eventId";
import { kvGetJson, kvSetJson } from "./kv";

export async function fetchTeamEvents(): Promise<TeamEvent[]> {
  const url = process.env.SPORTLINK_ICAL_URL;
  if (!url) {
    throw new Error("SPORTLINK_ICAL_URL environment variable is not set");
  }

  const cacheKey = "calendar:events:v1";
  let parsed: TeamEvent[] | null = null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch iCal: ${res.status}`);
    const text = await res.text();
    const data = ical.parseICS(text);
    parsed = Object.values(data)
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
      });
  } catch {
    // Ignore; we'll fall back to cache below
  }

  const cached = (await kvGetJson<TeamEvent[]>(cacheKey)) || [];

  // Merge: new data overrides cached entries by id; cached preserves past events missing from current feed
  const map = new Map<string, TeamEvent>();
  for (const e of cached) map.set(e.id, e);
  if (parsed) {
    for (const e of parsed) map.set(e.id, e);
  }
  let merged = Array.from(map.values()).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  // Prune to a reasonable window (keep one year back and one year ahead) to avoid unbounded growth
  const now = Date.now();
  const windowMs = 365 * 24 * 60 * 60 * 1000;
  merged = merged.filter((e) => Math.abs(new Date(e.start).getTime() - now) <= windowMs);

  // Update cache if we had a successful parse; otherwise return cached as-is
  if (parsed) {
    await kvSetJson(cacheKey, merged).catch(() => {});
  } else if (cached.length) {
    merged = cached;
  }

  return merged;
}


