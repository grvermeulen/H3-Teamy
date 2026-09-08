import { beforeEach, describe, expect, it, vi } from "vitest";

const presenceGet = vi.fn();
const channelsGet = vi.fn();
const matchFindUnique = vi.fn();
const matchCreate = vi.fn();
const resultGroupBy = vi.fn();
const userFindMany = vi.fn();

vi.mock("ably", () => ({
  Rest: class {
    channels = { get: channelsGet };
  },
}));
vi.mock("../db", () => ({
  prisma: {
    arenaMatch: {
      findUnique: (...a: unknown[]) => matchFindUnique(...a),
      create: (...a: unknown[]) => matchCreate(...a),
    },
    arenaMatchResult: { groupBy: (...a: unknown[]) => resultGroupBy(...a) },
    user: { findMany: (...a: unknown[]) => userFindMany(...a) },
  },
}));

const { recordMatch, leaderboard, MAX_MATCH_COUNT } =
  await import("./arenaMatchService");

const KEY = "app.key:secret";

/** A presence member, as Ably's REST page returns one. */
function member(clientId: string, timestamp: number, device = "desktop") {
  return {
    clientId,
    timestamp,
    data: { name: clientId, colour: "#fff", role: "player", device },
  };
}

/** A potje with two players. */
function potje(overrides: Record<string, unknown> = {}) {
  return {
    roomCode: "7K4M2Q",
    zone: "wageningen",
    startedAt: new Date("2026-09-08T18:00:00.000Z"),
    endedAt: new Date("2026-09-08T18:03:00.000Z"),
    results: [
      { userId: "host", kills: 3, deaths: 1, won: true },
      { userId: "guest", kills: 1, deaths: 3, won: false },
    ],
    ...overrides,
  };
}

describe("recordMatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelsGet.mockReturnValue({ presence: { get: presenceGet } });
    // "host" entered first, so electHost picks it.
    presenceGet.mockResolvedValue({
      items: [member("host", 1), member("guest", 2)],
    });
    matchFindUnique.mockResolvedValue(null);
    matchCreate.mockResolvedValue({ id: "match-1" });
  });

  it("records a potje posted by the room's host", async () => {
    const outcome = await recordMatch(KEY, "host", potje());
    expect(outcome).toEqual({ ok: true, matchId: "match-1", recorded: 2 });
    expect(channelsGet).toHaveBeenCalledWith("arena:room:7K4M2Q");
  });

  it("refuses someone who is not the host, even if they were in the room", async () => {
    expect(await recordMatch(KEY, "guest", potje())).toEqual({
      ok: false,
      reason: "not-host",
    });
    expect(matchCreate).not.toHaveBeenCalled();
  });

  it("refuses someone who was never in the room at all", async () => {
    expect(await recordMatch(KEY, "stranger", potje())).toEqual({
      ok: false,
      reason: "not-host",
    });
  });

  it("refuses a potje with fewer than two players", async () => {
    const solo = potje({
      results: [{ userId: "host", kills: 0, deaths: 0, won: false }],
    });
    expect(await recordMatch(KEY, "host", solo)).toEqual({
      ok: false,
      reason: "too-few-players",
    });
  });

  it("drops a line for someone who was not in the room", async () => {
    // Otherwise a host could award or ruin stats for a player who never took part.
    const withOutsider = potje({
      results: [
        ...potje().results,
        { userId: "never-played", kills: 99, deaths: 0, won: true },
      ],
    });
    const outcome = await recordMatch(KEY, "host", withOutsider);
    expect(outcome).toEqual({ ok: true, matchId: "match-1", recorded: 2 });
    const created = matchCreate.mock.calls[0]?.[0] as {
      data: { results: { create: { userId: string }[] } };
    };
    expect(created.data.results.create.map((row) => row.userId)).toEqual([
      "host",
      "guest",
    ]);
  });

  it("refuses when dropping outsiders leaves fewer than two real players", async () => {
    const mostlyFake = potje({
      results: [
        { userId: "host", kills: 1, deaths: 0, won: true },
        { userId: "ghost-a", kills: 0, deaths: 1, won: false },
        { userId: "ghost-b", kills: 0, deaths: 1, won: false },
      ],
    });
    expect(await recordMatch(KEY, "host", mostlyFake)).toEqual({
      ok: false,
      reason: "no-eligible-players",
    });
  });

  it("records the same potje only once", async () => {
    matchFindUnique.mockResolvedValue({ id: "match-1" });
    expect(await recordMatch(KEY, "host", potje())).toEqual({
      ok: false,
      reason: "already-recorded",
    });
    expect(matchCreate).not.toHaveBeenCalled();
  });

  it("identifies a potje by its room and start time", async () => {
    await recordMatch(KEY, "host", potje());
    expect(matchFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomCode_startedAt: {
            roomCode: "7K4M2Q",
            startedAt: new Date("2026-09-08T18:00:00.000Z"),
          },
        },
      }),
    );
  });

  it("bounds absurd counts rather than writing them to a leaderboard", async () => {
    await recordMatch(
      KEY,
      "host",
      potje({
        results: [
          { userId: "host", kills: 1e9, deaths: -5, won: true },
          { userId: "guest", kills: 2.6, deaths: 0, won: false },
        ],
      }),
    );
    const created = matchCreate.mock.calls[0]?.[0] as {
      data: { results: { create: { kills: number; deaths: number }[] } };
    };
    expect(created.data.results.create[0]).toMatchObject({
      kills: MAX_MATCH_COUNT,
      deaths: 0,
    });
    expect(created.data.results.create[1]?.kills).toBe(3);
  });

  it("keeps who hosted", async () => {
    await recordMatch(KEY, "host", potje());
    const created = matchCreate.mock.calls[0]?.[0] as {
      data: { hostUserId: string };
    };
    expect(created.data.hostUserId).toBe("host");
  });
});

describe("leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ranks on wins, then kills", async () => {
    resultGroupBy
      .mockResolvedValueOnce([
        { userId: "a", _sum: { kills: 10, deaths: 2 }, _count: { _all: 3 } },
        { userId: "b", _sum: { kills: 30, deaths: 1 }, _count: { _all: 3 } },
        { userId: "c", _sum: { kills: 20, deaths: 9 }, _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([
        { userId: "a", _count: { _all: 3 } },
        { userId: "c", _count: { _all: 3 } },
      ]);
    userFindMany.mockResolvedValue([
      { id: "a", firstName: "Ann" },
      { id: "b", firstName: "Bo" },
      { id: "c", firstName: "Cas" },
    ]);
    const rows = await leaderboard();
    // a and c both have 3 wins; c has more kills. b has none.
    expect(rows.map((row) => row.userId)).toEqual(["c", "a", "b"]);
    expect(rows[0]).toMatchObject({ firstName: "Cas", wins: 3, kills: 20 });
    expect(rows[2]).toMatchObject({ wins: 0, kills: 30 });
  });

  it("names a player with no first name rather than leaving a gap", async () => {
    resultGroupBy
      .mockResolvedValueOnce([
        { userId: "a", _sum: { kills: 1, deaths: 0 }, _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([]);
    userFindMany.mockResolvedValue([{ id: "a", firstName: "  " }]);
    expect((await leaderboard())[0]?.firstName).toBe("Speler");
  });

  it("is empty when nobody has played", async () => {
    resultGroupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    userFindMany.mockResolvedValue([]);
    expect(await leaderboard()).toEqual([]);
  });

  it("returns at most the size asked for", async () => {
    resultGroupBy
      .mockResolvedValueOnce(
        Array.from({ length: 20 }, (_, index) => ({
          userId: `u${index}`,
          _sum: { kills: index, deaths: 0 },
          _count: { _all: 1 },
        })),
      )
      .mockResolvedValueOnce([]);
    userFindMany.mockResolvedValue([]);
    expect(await leaderboard(10)).toHaveLength(10);
  });
});
