import type { TeamEvent } from "../types";
import { amsterdamWallClockToIso } from "./amsterdamEventStart";
import { canonicalEventId } from "./eventId";

/** Admin import preset: eerste twee H3-wedstrijden 2026–2027 die niet in Sportlink staan. */
export const TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026 =
  "h3-gap-oct-nov-2026" as const;

export type TeamEventImportPresetId =
  typeof TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026;

export type VerifiedTeamEventFixture = {
  title: string;
  amsterdamStart: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  };
  location?: string;
  /** Publieke KNZB-URL ter verificatie (geen uitslag in metadata). */
  sourceUrl: string;
};

/**
 * KNZB-geverifieerde ontbrekende wedstrijden (De Rijn H3, seizoen 2026–2027).
 * Titels en tijden conform KNZB-verenigingspagina / wedstrijdpagina.
 */
export const H3_GAP_OCT_NOV_2026_FIXTURES: VerifiedTeamEventFixture[] = [
  {
    title: "NDD H3 - De Rijn H3",
    amsterdamStart: {
      year: 2026,
      month: 10,
      day: 10,
      hour: 18,
      minute: 40,
    },
    location: "Sportcentrum Rozengaarde Doetinchem",
    sourceUrl:
      "https://waterpolo.knzb.nl/waterpolo/verenigingen/vereniging/DHS128P",
  },
  {
    title: "De Rijn H3 - Flevo H3",
    amsterdamStart: {
      year: 2026,
      month: 11,
      day: 7,
      hour: 18,
      minute: 50,
    },
    location: "Sportfondsenbad De Bongerd Wageningen",
    sourceUrl: "https://waterpolo.knzb.nl/waterpolo/wedstrijd/451382",
  },
];

/**
 * Zet geverifieerde KNZB-fixtures om naar `TeamEvent` met canonical id.
 */
export function verifiedFixturesToTeamEvents(
  fixtures: VerifiedTeamEventFixture[],
): TeamEvent[] {
  return fixtures.map((f) => {
    const start = amsterdamWallClockToIso(f.amsterdamStart);
    const id = canonicalEventId(f.title, start);
    return {
      id,
      title: f.title,
      start,
      location: f.location,
      description: `Bron: KNZB ${f.sourceUrl}`,
    };
  });
}

export function teamEventsForImportPreset(
  preset: TeamEventImportPresetId,
): TeamEvent[] {
  switch (preset) {
    case TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026:
      return verifiedFixturesToTeamEvents(H3_GAP_OCT_NOV_2026_FIXTURES);
    default: {
      const _exhaustive: never = preset;
      return _exhaustive;
    }
  }
}
