import EventList from "../components/EventList";
import Link from "next/link";

import { fetchTeamEvents } from "../lib/ical";

export const dynamic = "force-dynamic";

export default async function Page() {
  const events = await fetchTeamEvents();
  return (
    <main>
      <div className="container">
        <h1>De Rijn H3 — Waterpolo</h1>
        <div className="muted">Matches from Sportlink (read-only)</div>
        <EventList events={events} />
      </div>
    </main>
  );
}
