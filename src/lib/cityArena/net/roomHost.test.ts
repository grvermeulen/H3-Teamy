import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  presenceOf,
  resolveRoomHost,
  snapshotSightings,
  type RoomRest,
} from "./roomHost";

/** A presence member, as Ably's REST page returns one. */
function member(clientId: string, timestamp: number): unknown {
  return {
    clientId,
    timestamp,
    data: { name: clientId, colour: "#fff", role: "player", device: "desktop" },
  };
}

/** A snapshot message in the history. */
function state(clientId: string, timestamp: number): unknown {
  return { name: "state", clientId, timestamp };
}

/**
 * A REST client whose every channel has this presence set and this history, given newest first
 * and split into pages. `pagesRead` counts the pages actually fetched.
 */
function rest(
  presence: unknown[],
  pages: unknown[][],
  presenceError?: Error,
): RoomRest & { pagesRead: () => number } {
  let read = 0;
  const pageAt = (index: number): unknown => {
    read += 1;
    return {
      items: pages[index] ?? [],
      hasNext: () => index + 1 < pages.length,
      next: async () => pageAt(index + 1),
    };
  };
  return {
    pagesRead: () => read,
    channels: {
      get: vi.fn(() => ({
        presence: {
          get: async () => {
            if (presenceError) throw presenceError;
            return { items: presence };
          },
        },
        history: async () => pageAt(0),
      })),
    },
  } as unknown as RoomRest & { pagesRead: () => number };
}

describe("roomHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads a presence set as the election reads it", async () => {
    const members = await presenceOf(
      rest([member("a", 1), member("b", 2)], []),
      "arena:room:7K4M2Q",
    );
    expect(members.map((m) => [m.clientId, m.timestamp])).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("collects the newest snapshot per publisher within the window, across pages", async () => {
    const api = rest(
      [],
      [
        [
          state("b", 9_500),
          { name: "control", clientId: "x", timestamp: 9_400 },
        ],
        [state("a", 9_300), state("b", 9_000)],
        [state("a", 8_000)],
      ],
    );
    const sightings = await snapshotSightings(api, "arena:room:7K4M2Q", 8_500);
    expect(sightings).toEqual([
      { clientId: "b", timestamp: 9_500 },
      { clientId: "a", timestamp: 9_300 },
    ]);
    // The third page starts past the window, so it is read and then paging stops.
    expect(api.pagesRead()).toBe(3);
  });

  it("stops paging once a page reaches past the window", async () => {
    const api = rest(
      [],
      [[state("b", 9_500)], [state("a", 7_000)], [state("c", 6_000)]],
    );
    expect(await snapshotSightings(api, "c", 8_500)).toEqual([
      { clientId: "b", timestamp: 9_500 },
    ]);
    expect(api.pagesRead()).toBe(2);
  });

  it("skips other names and snapshots without a publisher", async () => {
    const api = rest(
      [],
      [
        [
          { name: "control", clientId: "x", timestamp: 9_500 },
          { name: "state", timestamp: 9_400 },
          { name: "state", clientId: "y" },
        ],
      ],
    );
    expect(await snapshotSightings(api, "c", 0)).toEqual([]);
    expect(await snapshotSightings(rest([], []), "c", 0)).toEqual([]);
  });

  it("names the best-ranked member heard from, from the room's own channel", async () => {
    const members = [member("a", 1), member("b", 2)];
    const heardOnlyB = rest(members, [[state("b", 9_000)]]);
    const result = await resolveRoomHost(heardOnlyB, "7K4M2Q", 10_000);
    expect(heardOnlyB.channels.get).toHaveBeenCalledWith("arena:room:7K4M2Q");
    expect(result.host).toBe("b");
    expect(result.members.map((m) => m.clientId)).toEqual(["a", "b"]);

    const heardBoth = rest(members, [[state("b", 9_900), state("a", 9_000)]]);
    expect((await resolveRoomHost(heardBoth, "7K4M2Q", 10_000)).host).toBe("a");
  });

  it("falls back to the presence election when the history is stale", async () => {
    const api = rest([member("a", 1), member("b", 2)], [[state("b", 0)]]);
    expect((await resolveRoomHost(api, "7K4M2Q", 60_000)).host).toBe("a");
  });

  it("lets a failed read surface rather than guessing", async () => {
    const api = rest([], [], new Error("ably down"));
    await expect(resolveRoomHost(api, "7K4M2Q")).rejects.toThrow("ably down");
  });
});
