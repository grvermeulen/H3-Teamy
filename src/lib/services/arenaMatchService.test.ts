import { beforeEach, describe, expect, it, vi } from "vitest";
const { queryRaw, userFindMany } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  userFindMany: vi.fn(),
}));
vi.mock("../db", () => ({
  prisma: { $queryRaw: queryRaw, user: { findMany: userFindMany } },
}));
const { leaderboard } = await import("./arenaMatchService");

describe("leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the database's ranking with bigint totals turned into numbers", async () => {
    // The ORDER BY lives in SQL now, so the rows arrive ranked; the service's job is to name
    // them and to turn Postgres's bigint sums into plain numbers the JSON response can carry.
    queryRaw.mockResolvedValue([
      { userId: "c", wins: 3n, kills: 20n, deaths: 9n },
      { userId: "a", wins: 3n, kills: 10n, deaths: 2n },
      { userId: "b", wins: 0n, kills: 30n, deaths: 1n },
    ]);
    userFindMany.mockResolvedValue([
      { id: "a", firstName: "Ann" },
      { id: "b", firstName: "Bo" },
      { id: "c", firstName: "Cas" },
    ]);
    const rows = await leaderboard();
    expect(rows.map((row) => row.userId)).toEqual(["c", "a", "b"]);
    expect(rows[0]).toEqual({
      userId: "c",
      firstName: "Cas",
      wins: 3,
      kills: 20,
      deaths: 9,
    });
    expect(typeof rows[2]?.kills).toBe("number");
  });

  it("asks the database for at most the size wanted, and only those users", async () => {
    queryRaw.mockResolvedValue([
      { userId: "a", wins: 1n, kills: 1n, deaths: 0n },
    ]);
    userFindMany.mockResolvedValue([{ id: "a", firstName: "Ann" }]);
    await leaderboard(7);
    // The tagged template's interpolated values are the last argument group; the limit must
    // reach the query rather than being applied in memory afterwards.
    const call = queryRaw.mock.calls[0] ?? [];
    expect(call.slice(1)).toContain(7);
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["a"] } }, take: 7 }),
    );
  });

  it("names a player with no first name rather than leaving a gap", async () => {
    queryRaw.mockResolvedValue([
      { userId: "a", wins: 1n, kills: 1n, deaths: 0n },
    ]);
    userFindMany.mockResolvedValue([{ id: "a", firstName: "  " }]);
    expect((await leaderboard())[0]?.firstName).toBe("Speler");
  });

  it("is empty when nobody has played", async () => {
    queryRaw.mockResolvedValue([]);
    userFindMany.mockResolvedValue([]);
    expect(await leaderboard()).toEqual([]);
  });
});
