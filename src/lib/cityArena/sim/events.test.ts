import { describe, expect, it } from "vitest";
import { eventsOfKind, pushEvent } from "./events";
import { MAX_EVENTS } from "./limits";
import type { ArenaEvent } from "./types";

const shot: ArenaEvent = {
  kind: "shot",
  weapon: "pistol",
  ownerId: 0,
  x: 1,
  y: 2,
};
const boom: ArenaEvent = { kind: "explosion", x: 5, y: 6 };

describe("events", () => {
  it("appends events and filters them by kind", () => {
    const events = pushEvent(pushEvent([], shot), boom);
    expect(events).toEqual([shot, boom]);
    expect(eventsOfKind(events, "shot")).toEqual([shot]);
    expect(eventsOfKind(events, "explosion")[0].x).toBe(5);
    expect(eventsOfKind(events, "pickup")).toEqual([]);
  });

  it("keeps the oldest events once the per-tick cap is reached", () => {
    let events: ArenaEvent[] = [];
    for (let index = 0; index < MAX_EVENTS + 5; index++)
      events = pushEvent(events, { ...shot, x: index });
    expect(events).toHaveLength(MAX_EVENTS);
    expect(events[MAX_EVENTS - 1]).toMatchObject({ x: MAX_EVENTS - 1 });
  });
});
