import EventList from "../components/EventList";
import dynamic from "next/dynamic";

import { fetchTeamEvents } from "../lib/ical";

export default async function Page() {
  const events = await fetchTeamEvents();
  const AuthBar = dynamic(() => import("../components/AuthBar"), { ssr: false });
  return (
    <main>
      <div className="container">
        <h1>De Rijn H3 — Waterpolo</h1>
        <div className="muted">Matches from Sportlink (read-only), RSVP stored locally</div>
        <AuthBar />
        <EventList events={events} />
      </div>
    </main>
  );
}


