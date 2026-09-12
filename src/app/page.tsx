import EventList from "../components/EventList";

import { fetchTeamEvents } from "../lib/ical";
import { getFeatureFlag } from "../lib/featureFlags";

export const dynamic = "force-dynamic";

export default async function Page() {
  const events = await fetchTeamEvents();
  const gtaH3Enabled = await getFeatureFlag("gtaH3Launcher");
  return (
    <main>
      <div className="container">
        <h2 style={{ marginTop: 4 }}>Aankomende wedstrijden</h2>
        <EventList events={events} gtaH3Enabled={gtaH3Enabled} />
      </div>
    </main>
  );
}
