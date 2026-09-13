import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { list, limit, capture } = vi.hoisted(() => ({
  list: vi.fn(),
  limit: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("@/lib/services/arenaRoomService", () => ({ listArenaRooms: list }));
vi.mock("@/lib/rateLimit", async (original) => ({
  ...(await original<typeof import("@/lib/rateLimit")>()),
  checkRateLimit: limit,
}));
vi.mock("@sentry/nextjs", () => ({ captureException: capture }));
import { GET } from "./route";
const request = () =>
  new NextRequest("http://localhost/api/arena/rooms", {
    headers: { "x-forwarded-for": "203.0.113.5" },
  });
describe("server-registered arena rooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockResolvedValue({ allowed: true });
    list.mockResolvedValue([]);
  });
  it("serves server room records and permits a brief browser cache", async () => {
    const rooms = [
      {
        roomCode: "ABC234",
        zone: "campus",
        hostName: "Guido",
        players: 2,
        phase: "lobby",
      },
    ];
    list.mockResolvedValue(rooms);
    const response = await GET(request());
    expect(await response.json()).toEqual({ rooms });
    expect(response.headers.get("Cache-Control")).toContain("max-age=5");
  });
  it("distinguishes a database outage from an empty lobby", async () => {
    expect((await GET(request())).status).toBe(200);
    list.mockRejectedValueOnce(new Error("database down"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/beschikbaar/);
    expect(capture).toHaveBeenCalledTimes(1);
  });
  it("limits room reads before database work", async () => {
    limit.mockResolvedValue({ allowed: false, retryAfterSec: 15 });
    expect((await GET(request())).status).toBe(429);
    expect(list).not.toHaveBeenCalled();
  });
});
