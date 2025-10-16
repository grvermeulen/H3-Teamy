import EventList from "../components/EventList";
import Link from "next/link";
import NextDynamic from "next/dynamic";

import { getSeasonEvents } from "../lib/events";

export const dynamic = "force-dynamic";

export default async function Page() {
  let events = await getSeasonEvents(false).catch(() => []);
  const SessionStatus = NextDynamic(() => import("../components/SessionStatus"), { ssr: false });
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


