import { describe, expect, it } from "vitest";
import { canonicalEventId } from "./eventId";
import {
  H3_GAP_OCT_NOV_2026_FIXTURES,
  teamEventsForImportPreset,
  TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026,
  verifiedFixturesToTeamEvents,
} from "./knzbVerifiedH3Gap2026";

describe("knzbVerifiedH3Gap2026", () => {
  it("levert exact twee canonical ids voor het H3-gat okt/nov 2026", () => {
    const events = verifiedFixturesToTeamEvents(H3_GAP_OCT_NOV_2026_FIXTURES);
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe("20261010--ndd-h3-de-rijn-h3");
    expect(events[0].start).toBe("2026-10-10T16:40:00.000Z");
    expect(events[1].id).toBe("20261107--de-rijn-h3-flevo-h3");
    expect(events[1].start).toBe("2026-11-07T17:50:00.000Z");
    for (const e of events) {
      expect(e.id).toBe(canonicalEventId(e.title, e.start));
    }
  });

  it("preset h3-gap-oct-nov-2026 komt overeen met fixtures", () => {
    const fromPreset = teamEventsForImportPreset(
      TEAM_EVENT_IMPORT_PRESET_H3_GAP_OCT_NOV_2026,
    );
    const fromFixtures = verifiedFixturesToTeamEvents(
      H3_GAP_OCT_NOV_2026_FIXTURES,
    );
    expect(fromPreset).toEqual(fromFixtures);
  });
});
