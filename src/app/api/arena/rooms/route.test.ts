import { beforeEach, describe, expect, it, vi } from "vitest";

/** Presence per channel name; the route now reads the lobby *and* each advertised room. */
const presenceByChannel = new Map<string, unknown[]>();
const channelsGet = vi.fn((name: string) => ({
  presence: {
    get: async () => ({ items: presenceByChannel.get(name) ?? [] }),
  },
}));
const captureException = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));
vi.mock("ably", () => ({
  Rest: class {
    channels = { get: channelsGet };
  },
}));

const { GET } = await import("./route");

/** One lobby presence entry, as Ably's REST presence page returns it. */
function entry(
  clientId: string,
  room: unknown,
  timestamp = 1,
  name = "Noor",
): unknown {
  return {
    clientId,
    timestamp,
    data: { name, colour: "#f5a524", role: "player", device: "desktop", room },
  };
}

const ROOM = {
  roomCode: "7K4M2Q",
  zone: "wageningen",
  players: 3,
  phase: "lobby",
};

describe("GET /api/arena/rooms", () => {
  /** Seeds the lobby with `advertisers` and seats each one as host of the room it advertises. */
  function host(
    ...advertisers: {
      clientId: string;
      room: typeof ROOM;
      ts?: number;
      name?: string;
    }[]
  ) {
    presenceByChannel.set(
      "arena:lobby",
      advertisers.map((a) =>
        entry(a.clientId, a.room, a.ts ?? 1, a.name ?? "Noor"),
      ),
    );
    for (const a of advertisers)
      presenceByChannel.set(`arena:room:${a.room.roomCode}`, [
        entry(a.clientId, undefined, a.ts ?? 1, a.name ?? "Noor"),
      ]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ABLY_API_KEY", "app.key:secret");
    presenceByChannel.clear();
  });

  it("reads the lobby channel, not a room channel", async () => {
    await GET();
    expect(channelsGet).toHaveBeenCalledWith("arena:lobby");
  });

  it("returns the rooms currently advertised", async () => {
    host(
      { clientId: "a", room: ROOM, ts: 1, name: "Noor" },
      {
        clientId: "b",
        room: { ...ROOM, roomCode: "ABC234", players: 5, phase: "playing" },
        ts: 2,
        name: "Sam",
      },
    );
    const body = await (await GET()).json();
    expect(body.rooms).toHaveLength(2);
    expect(body.rooms[0]).toEqual({
      roomCode: "7K4M2Q",
      zone: "wageningen",
      hostName: "Noor",
      players: 3,
      phase: "lobby",
    });
    expect(body.rooms[1].phase).toBe("playing");
  });

  it("drops a malformed advertisement rather than serving it", async () => {
    host({ clientId: "b", room: ROOM });
    presenceByChannel.set("arena:lobby", [
      entry("a", { ...ROOM, zone: "atlantis" }),
      entry("b", ROOM),
    ]);
    const body = await (await GET()).json();
    expect(body.rooms).toHaveLength(1);
    expect(body.rooms[0].roomCode).toBe("7K4M2Q");
  });

  it("drops a room whose advertiser is not really its host", async () => {
    // Any member can enter lobby presence with a made-up room. "x" advertises 7K4M2Q, but the
    // room's own presence set says "a" is in it and nobody else — so "x" is not its host.
    presenceByChannel.set("arena:lobby", [entry("x", ROOM, 5, "Forger")]);
    presenceByChannel.set("arena:room:7K4M2Q", [entry("a", undefined, 1)]);
    const body = await (await GET()).json();
    expect(body.rooms).toEqual([]);
    expect(channelsGet).toHaveBeenCalledWith("arena:room:7K4M2Q");
  });

  it("drops a room that nobody is in at all", async () => {
    presenceByChannel.set("arena:lobby", [entry("x", ROOM)]);
    const body = await (await GET()).json();
    expect(body.rooms).toEqual([]);
  });

  it("is an empty list when nobody is hosting", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).rooms).toEqual([]);
  });

  it("lets the browser hold the list briefly, so an idle home page stays off Ably", async () => {
    const cacheControl = (await GET()).headers.get("Cache-Control");
    expect(cacheControl).toContain("max-age=5");
  });

  it("answers with no rooms and reports to Sentry when the key is missing", async () => {
    vi.stubEnv("ABLY_API_KEY", "");
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).rooms).toEqual([]);
    expect(captureException).toHaveBeenCalled();
  });

  it("answers with no rooms and reports to Sentry when Ably is unreachable", async () => {
    channelsGet.mockImplementationOnce(() => ({
      presence: { get: async () => Promise.reject(new Error("ably is down")) },
    }));
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).rooms).toEqual([]);
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { area: "arena", kind: "rooms" } }),
    );
  });

  it("never lets the API key reach the response", async () => {
    expect(await (await GET()).text()).not.toContain("secret");
  });
});
