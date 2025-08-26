import ical, { CalendarComponent } from "node-ical";
import { TeamEvent } from "../types";
import { canonicalEventId } from "./eventId";

export async function fetchTeamEvents(): Promise<TeamEvent[]> {
  const url = process.env.SPORTLINK_ICAL_URL;
  if (!url) {
    throw new Error("SPORTLINK_ICAL_URL environment variable is not set");
  }

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
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

  return events;
}


