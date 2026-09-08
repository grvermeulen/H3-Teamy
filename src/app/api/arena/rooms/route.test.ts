import { beforeEach, describe, expect, it, vi } from "vitest";

const presenceGet = vi.fn();
const channelsGet = vi.fn();
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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ABLY_API_KEY", "app.key:secret");
    channelsGet.mockReturnValue({ presence: { get: presenceGet } });
    presenceGet.mockResolvedValue({ items: [] });
  });

  it("reads the lobby channel, not a room channel", async () => {
    await GET();
    expect(channelsGet).toHaveBeenCalledWith("arena:lobby");
  });

  it("returns the rooms currently advertised", async () => {
    presenceGet.mockResolvedValue({
      items: [
        entry("a", ROOM, 1, "Noor"),
        entry(
          "b",
          { ...ROOM, roomCode: "ABC234", players: 5, phase: "playing" },
          2,
          "Sam",
        ),
      ],
    });
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
    presenceGet.mockResolvedValue({
      items: [entry("a", { ...ROOM, zone: "atlantis" }), entry("b", ROOM)],
    });
    const body = await (await GET()).json();
    expect(body.rooms).toHaveLength(1);
    expect(body.rooms[0].roomCode).toBe("7K4M2Q");
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
    presenceGet.mockRejectedValue(new Error("ably is down"));
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
