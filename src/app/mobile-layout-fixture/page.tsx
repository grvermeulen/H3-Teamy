import { notFound } from "next/navigation";
import {
  H3_GAP_OCT_NOV_2026_FIXTURES,
  verifiedFixturesToTeamEvents,
  type VerifiedTeamEventFixture,
} from "../../lib/knzbVerifiedH3Gap2026";
import MobileLayoutFixtureClient from "./MobileLayoutFixtureClient";

const EXTRA_FIXTURES: VerifiedTeamEventFixture[] = [
  {
    title: "PFC Rheden H2-De Rijn H3",
    amsterdamStart: {
      year: 2026,
      month: 11,
      day: 14,
      hour: 19,
      minute: 0,
    },
    location: "Biljoenbad Gruttostraat 3682 EE Driebergen-Rijsenburg",
    sourceUrl:
      "https://waterpolo.knzb.nl/waterpolo/wedstrijden/verenigingpagina/NDD128P?wedstrijd=very-long-path-segment-to-force-wrap/451999",
  },
];

/**
 * Alleen voor lokale/preview layout-verificatie (geen productie-inhoud).
 */
export default function MobileLayoutFixturePage() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_MOBILE_LAYOUT_FIXTURE !== "1"
  ) {
    notFound();
  }
  const events = verifiedFixturesToTeamEvents([
    ...H3_GAP_OCT_NOV_2026_FIXTURES,
    ...EXTRA_FIXTURES,
  ]);
  const nowMs = new Date("2026-11-08T14:30:00.000Z").getTime();

  return (
    <MobileLayoutFixtureClient events={events} nowMs={nowMs} />
  );
}
