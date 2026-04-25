import EventList from "../components/EventList";

import { fetchTeamEvents } from "../lib/ical";

export const dynamic = "force-dynamic";

export default async function Page() {
  const events = await fetchTeamEvents();
  return (
    <main>
      <div className="container">
        <h2 style={{ marginTop: 4 }}>Aankomende wedstrijden</h2>
        <EventList events={events} />
      </div>
    </main>
  );
}
