import { describe, expect, it } from "vitest";
import manifest from "./stations.json";
import {
  RADIO_STATIONS,
  RadioManifestSchema,
  nextStationAfter,
  stationById,
  trackUrl,
  type RadioStation,
} from "./stations";

const DIAL: RadioStation[] = [
  {
    id: "a",
    name: "A FM",
    tracks: [{ file: "a-1-00000000.mp3", title: "Een", seconds: 120 }],
  },
  {
    id: "b",
    name: "B FM",
    tracks: [{ file: "b-1-00000000.mp3", title: "Twee", seconds: 120 }],
  },
];

describe("radio stations", () => {
  it("ships a manifest that parses, and the parsed dial is what the game reads", () => {
    expect(RadioManifestSchema.parse(manifest).stations).toEqual(
      RADIO_STATIONS,
    );
  });

  it("rejects a file name that is not a hashed mp3", () => {
    const bad = {
      version: 1,
      stations: [
        {
          id: "a",
          name: "A",
          tracks: [{ file: "../x.mp3", title: "t", seconds: 1 }],
        },
      ],
    };
    expect(RadioManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("builds the track URL under the tracks directory", () => {
    expect(trackUrl(DIAL[0].tracks[0])).toBe(
      "/arena/radio/tracks/a-1-00000000.mp3",
    );
  });

  it("falls back to the first station for an unknown or absent id, and to null with no dial", () => {
    expect(stationById("b", DIAL)?.id).toBe("b");
    expect(stationById("zzz", DIAL)?.id).toBe("a");
    expect(stationById(undefined, DIAL)?.id).toBe("a");
    expect(stationById("a", [])).toBeNull();
  });

  it("cycles the dial and wraps", () => {
    expect(nextStationAfter("a", DIAL)?.id).toBe("b");
    expect(nextStationAfter("b", DIAL)?.id).toBe("a");
    expect(nextStationAfter("zzz", DIAL)?.id).toBe("a");
    expect(nextStationAfter("a", [])).toBeNull();
  });
});
