import EventList from "../components/EventList";
import Link from "next/link";
import dynamic from "next/dynamic";

import { fetchTeamEvents } from "../lib/ical";

export default async function Page() {
  const events = await fetchTeamEvents();
  const SessionStatus = dynamic(() => import("../components/SessionStatus"), { ssr: false });
  return (
    <main>
      <div className="container">
        <h1>De Rijn H3 — Waterpolo</h1>
        <div className="muted">Matches from Sportlink (read-only)</div>
        <div className="muted" style={{ marginTop: 6, display: "flex", gap: 12 }}>
          <SessionStatus />
          <Link href={"/profile" as any}>Profile</Link>
        </div>
        <EventList events={events} />
      </div>
    </main>
  );
}


