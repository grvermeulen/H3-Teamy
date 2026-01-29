import ical, { CalendarComponent } from "node-ical";
import { TeamEvent } from "../types";
import { canonicalEventId } from "./eventId";
import { kvGetJson, kvSetJson } from "./kv";

type ParsedEvent = TeamEvent & { baseId: string };

function formatUtcTimeId(startIso: string): string {
  const d = new Date(startIso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}${mm}`;
}

function makeUniqueId(baseId: string, startIso: string, used: Set<string>): string {
  const base = `${baseId}-${formatUtcTimeId(startIso)}`;
  if (!used.has(base)) return base;
  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

function ensureUniqueEventIds(parsed: ParsedEvent[], cached: TeamEvent[]): TeamEvent[] {
  const cachedByBase = new Map<string, TeamEvent[]>();
  for (const evt of cached) {
    const baseId = canonicalEventId(evt.title, evt.start);
    const group = cachedByBase.get(baseId) || [];
    group.push(evt);
    cachedByBase.set(baseId, group);
  }

  const grouped = new Map<string, ParsedEvent[]>();
  for (const evt of parsed) {
    const group = grouped.get(evt.baseId) || [];
    group.push(evt);
    grouped.set(evt.baseId, group);
  }

  const usedIds = new Set<string>();
  const out: TeamEvent[] = [];

  for (const [baseId, events] of grouped) {
    events.sort((a, b) => {
      const diff = new Date(a.start).getTime() - new Date(b.start).getTime();
      if (diff !== 0) return diff;
      const titleDiff = a.title.localeCompare(b.title);
      if (titleDiff !== 0) return titleDiff;
      return (a.uid || "").localeCompare(b.uid || "");
    });

    let baseEvent: ParsedEvent | undefined;
    const cachedGroup = cachedByBase.get(baseId) || [];
    const cachedBase = cachedGroup.find((c) => c.id === baseId) || cachedGroup[0];
    if (cachedBase) {
      if (cachedBase.uid) {
        baseEvent = events.find((e) => e.uid === cachedBase.uid);
      }
      if (!baseEvent) {
        const composite = `${cachedBase.start}|${cachedBase.title}`;
        baseEvent = events.find((e) => `${e.start}|${e.title}` === composite);
      }
    }
    if (!baseEvent) baseEvent = events[0];

    for (const evt of events) {
      if (evt === baseEvent) {
        if (!usedIds.has(baseId)) {
          usedIds.add(baseId);
          out.push({ ...evt, id: baseId });
          continue;
        }
      }
      const id = makeUniqueId(baseId, evt.start, usedIds);
      usedIds.add(id);
      out.push({ ...evt, id });
    }
  }

  return out;
}

export async function fetchTeamEvents(): Promise<TeamEvent[]> {
  const url = process.env.SPORTLINK_ICAL_URL;

  const cacheKey = "calendar:events:v1";
  let parsed: TeamEvent[] | null = null;

  const cached = (await kvGetJson<TeamEvent[]>(cacheKey)) || [];

  if (url) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to fetch iCal: ${res.status}`);
      const text = await res.text();
      const data = ical.parseICS(text);
      const raw = Object.values(data)
        .filter((c): c is CalendarComponent & { type: "VEVENT" } => c?.type === "VEVENT")
        .map((evt) => {
          const title = (evt.summary || "Match").toString();
          const startIso = evt.start instanceof Date ? evt.start.toISOString() : new Date(evt.start as any).toISOString();
          const baseId = canonicalEventId(title, startIso);
          return {
            baseId,
            id: baseId,
            uid: evt.uid?.toString(),
            title,
            start: startIso,
            end: evt.end ? (evt.end instanceof Date ? evt.end.toISOString() : new Date(evt.end as any).toISOString()) : undefined,
            location: evt.location?.toString(),
            description: evt.description?.toString(),
          } satisfies ParsedEvent;
        });
      parsed = ensureUniqueEventIds(raw, cached);
    } catch {
      // Ignore; we'll fall back to cache below
    }
  }

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


