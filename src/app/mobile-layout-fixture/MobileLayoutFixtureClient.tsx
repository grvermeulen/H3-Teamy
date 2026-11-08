"use client";

import type { TeamEvent } from "../../types";
import EventList from "../../components/EventList";
import { SessionContext } from "../../components/SessionContext";

const fixtureSession = {
  loading: false,
  loggedIn: true,
  isAdmin: true,
  isTrainer: false,
  refresh: async () => {},
};

export default function MobileLayoutFixtureClient({
  events,
  nowMs,
}: {
  events: TeamEvent[];
  nowMs: number;
}) {
  return (
    <SessionContext.Provider value={fixtureSession}>
      <main className="container" data-mobile-layout-fixture>
        <EventList events={events} nowMs={nowMs} />
      </main>
    </SessionContext.Provider>
  );
}
