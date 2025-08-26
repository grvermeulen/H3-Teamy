import ical, { CalendarComponent } from "node-ical";
import { TeamEvent } from "../types";

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
      const id = (evt.uid || evt.uid?.toString() || `${evt.start?.toISOString() || ""}-${evt.summary || ""}`).toString();
      return {
        id,
        uid: evt.uid?.toString(),
        title: (evt.summary || "Match").toString(),
        start: evt.start instanceof Date ? evt.start.toISOString() : new Date(evt.start as any).toISOString(),
        end: evt.end ? (evt.end instanceof Date ? evt.end.toISOString() : new Date(evt.end as any).toISOString()) : undefined,
        location: evt.location?.toString(),
        description: evt.description?.toString(),
      } satisfies TeamEvent;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return events;
}


