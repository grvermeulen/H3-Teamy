import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  latestSnapshotOf,
  presenceOf,
  resolveRoomHost,
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

/** A REST client whose every channel has this presence set and this history, newest first. */
function rest(presence: unknown[], history: unknown[]): RoomRest {
  return {
    channels: {
      get: vi.fn(() => ({
        presence: { get: async () => ({ items: presence }) },
        history: async () => ({ items: history }),
      })),
    },
  } as unknown as RoomRest;
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

  it("takes the newest state message as the sighting and skips other names", async () => {
    const sighting = await latestSnapshotOf(
      rest(
        [],
        [
          { name: "control", clientId: "x", timestamp: 9 },
          { name: "state", clientId: "b", timestamp: 8 },
          { name: "state", clientId: "a", timestamp: 7 },
        ],
      ),
      "arena:room:7K4M2Q",
    );
    expect(sighting).toEqual({ clientId: "b", timestamp: 8 });
  });

  it("has no sighting for an empty page or a snapshot without a publisher", async () => {
    expect(await latestSnapshotOf(rest([], []), "c")).toBeNull();
    expect(
      await latestSnapshotOf(rest([], [{ name: "state", timestamp: 8 }]), "c"),
    ).toBeNull();
  });

  it("names the recent publisher as the acting host, from the room's own channel", async () => {
    const api = rest(
      [member("a", 1), member("b", 2)],
      [{ name: "state", clientId: "b", timestamp: 9_000 }],
    );
    const result = await resolveRoomHost(api, "7K4M2Q", 10_000);
    expect(api.channels.get).toHaveBeenCalledWith("arena:room:7K4M2Q");
    expect(result.host).toBe("b");
    expect(result.members.map((m) => m.clientId)).toEqual(["a", "b"]);
  });

  it("falls back to the presence election when the history is stale", async () => {
    const api = rest(
      [member("a", 1), member("b", 2)],
      [{ name: "state", clientId: "b", timestamp: 0 }],
    );
    expect((await resolveRoomHost(api, "7K4M2Q", 60_000)).host).toBe("a");
  });
});
