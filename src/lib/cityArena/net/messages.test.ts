import { describe, expect, it } from "vitest";
import { parseArenaEvent, parseControl } from "./messages";

describe("control messages", () => {
  it("accepts every control the spec lists", () => {
    expect(
      parseControl({
        kind: "start",
        zone: "campus",
        seed: 7,
        startsAtTick: 0,
      })?.kind,
    ).toBe("start");
    expect(parseControl({ kind: "zone", zone: "rhenen" })?.kind).toBe("zone");
    expect(parseControl({ kind: "join" })?.kind).toBe("join");
    expect(parseControl({ kind: "leave" })?.kind).toBe("leave");
  });

  it("rejects a malformed message rather than throwing", () => {
    expect(
      parseControl({ kind: "start", zone: "atlantis", seed: 1 }),
    ).toBeNull();
    expect(parseControl({ kind: "explode" })).toBeNull();
    expect(parseControl("start")).toBeNull();
    expect(parseControl(null)).toBeNull();
    expect(parseControl(undefined)).toBeNull();
    expect(parseControl([1, 2, 3])).toBeNull();
  });

  it("rejects a start whose seed or tick is not a whole number", () => {
    const base = { kind: "start", zone: "campus", seed: 1, startsAtTick: 0 };
    expect(parseControl({ ...base, seed: 1.5 })).toBeNull();
    expect(parseControl({ ...base, startsAtTick: -1 })).toBeNull();
  });
});

describe("arena events", () => {
  it("accepts a kill with and without a killer", () => {
    expect(
      parseArenaEvent({
        kind: "kill",
        killer: 1,
        victim: 2,
        weapon: "uzi",
      })?.kind,
    ).toBe("kill");
    expect(
      parseArenaEvent({
        kind: "kill",
        killer: null,
        victim: 2,
        weapon: "shotgun",
      })?.kind,
    ).toBe("kill");
  });

  it("accepts the rest of the event kinds", () => {
    const events: unknown[] = [
      { kind: "explosion", x: 1, y: 2 },
      { kind: "pickup", id: 3, by: 0 },
      { kind: "wanted", player: 0, level: 2 },
      { kind: "phase", phase: "playing" },
      { kind: "join", id: 1, name: "Bo", colour: "#0f0" },
      { kind: "leave", id: 1 },
      { kind: "hostChanged", id: "abc" },
      { kind: "damage", victim: 0, total: 25, source: "bullet" },
    ];
    for (const event of events) expect(parseArenaEvent(event)).not.toBeNull();
  });

  it("rejects an unknown weapon, source or kind", () => {
    expect(
      parseArenaEvent({ kind: "kill", killer: 1, victim: 2, weapon: "laser" }),
    ).toBeNull();
    expect(
      parseArenaEvent({ kind: "damage", victim: 0, total: 1, source: "curse" }),
    ).toBeNull();
    expect(parseArenaEvent({ kind: "teleport", x: 1 })).toBeNull();
  });
});
