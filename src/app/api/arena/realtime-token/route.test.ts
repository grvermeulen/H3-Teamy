import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roomTicket } from "@/lib/cityArena/net/roomProtocol.testFixtures";
import { arenaChannels, ROOM_RULES } from "@/lib/cityArena/net/roomProtocol";
const { authorize, membership, sign, limit, capture } = vi.hoisted(() => ({
  authorize: vi.fn(),
  membership: vi.fn(),
  sign: vi.fn(),
  limit: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("@/lib/arenaAuth", () => ({ authorizeArenaRequest: authorize }));
vi.mock("@/lib/services/arenaRoomService", async (original) => ({
  ...(await original<typeof import("@/lib/services/arenaRoomService")>()),
  authorizeArenaToken: membership,
}));
vi.mock("@/lib/rateLimit", async (original) => ({
  ...(await original<typeof import("@/lib/rateLimit")>()),
  checkRateLimit: limit,
}));
vi.mock("@sentry/nextjs", () => ({ captureException: capture }));
vi.mock("ably", () => ({
  Rest: class {
    auth = { createTokenRequest: sign };
  },
}));
import { ArenaRoomError } from "@/lib/services/arenaRoomService";
import { GET } from "./route";

const request = () =>
  new NextRequest(
    "http://localhost/api/arena/realtime-token?memberId=" +
      roomTicket().memberId,
  );
describe("room-scoped realtime tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ABLY_API_KEY", "test.key:server-secret");
    authorize.mockResolvedValue({ userId: "account", displayName: "Guido" });
    membership.mockResolvedValue(roomTicket());
    limit.mockResolvedValue({ allowed: true });
    sign.mockImplementation(async (options) => ({
      ...options,
      capability: JSON.stringify(options.capability),
      keyName: "test.key",
      mac: "signature",
      nonce: "nonce",
      timestamp: Date.now(),
    }));
  });
  afterEach(() => vi.unstubAllEnvs());
  it("issues an opaque seat identity with exact epoch channels and no wildcard", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.clientId).toBe(roomTicket().memberId);
    expect(body.displayName).toBe("Guido");
    expect(body.ticket.epoch).toBe(1);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(JSON.stringify(body)).not.toContain("server-secret");
    const signed = sign.mock.calls[0][0];
    expect(signed.ttl).toBe(ROOM_RULES.tokenTtlMs);
    expect(
      Object.keys(signed.capability).every(
        (key) => key.startsWith("arena:v2:") && !key.includes("*"),
      ),
    ).toBe(true);
    expect(membership).toHaveBeenCalledWith("account", roomTicket().memberId);
  });
  it("withholds state publication from an ordinary player", async () => {
    membership.mockResolvedValue(
      roomTicket({ hostClientId: "33333333-3333-4333-8333-333333333333" }),
    );
    await GET(request());
    const channels = arenaChannels(roomTicket().roomId, 1);
    expect(sign.mock.calls[0][0].capability[channels.state]).toEqual([
      "subscribe",
    ]);
    expect(sign.mock.calls[0][0].capability[channels.inputs]).toEqual([
      "publish",
    ]);
  });
  it("refuses missing sessions, membership and room identifiers before signing", async () => {
    authorize.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect((await GET(request())).status).toBe(401);
    expect(
      (await GET(new NextRequest("http://localhost/api/arena/realtime-token")))
        .status,
    ).toBe(400);
    membership.mockRejectedValueOnce(
      new ArenaRoomError("not-member", 403, "Geen deelnemer"),
    );
    expect((await GET(request())).status).toBe(403);
    expect(sign).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
  it("limits token churn before looking up membership", async () => {
    limit.mockResolvedValue({ allowed: false, retryAfterSec: 20 });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("20");
    expect(membership).not.toHaveBeenCalled();
  });
  it("fails closed on missing keys, invalid signed responses and signing errors", async () => {
    vi.stubEnv("ABLY_API_KEY", "");
    expect((await GET(request())).status).toBe(503);
    vi.stubEnv("ABLY_API_KEY", "test.key:server-secret");
    sign.mockResolvedValueOnce({});
    expect((await GET(request())).status).toBe(502);
    sign.mockRejectedValueOnce(new Error("signing failed"));
    expect((await GET(request())).status).toBe(502);
    expect(capture).toHaveBeenCalledTimes(2);
  });
});
