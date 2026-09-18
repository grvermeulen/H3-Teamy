import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../src/lib/authOptions", () => ({ authOptions: {} }));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));
import { prisma } from "../../src/lib/db";
import { POST, PATCH, GET } from "../../src/app/api/arena/display-token/route";
import { GET as playerToken } from "../../src/app/api/arena/realtime-token/route";
import { POST as displayMatch } from "../../src/app/api/arena/display-matches/route";
import {
  arenaChannels,
  type ArenaRoomTicket,
} from "../../src/lib/cityArena/net/roomProtocol";
import {
  ARENA_DISPLAY_COOKIE,
  createArenaDisplayKey,
} from "../../src/lib/arenaDisplayIdentity";

const rooms: string[] = [];
function request(
  method: string,
  body?: unknown,
  cookie = "",
  path = "display-token",
  origin = "https://arena.example.test",
  address = "192.0.2.76",
) {
  return new NextRequest(`https://arena.example.test/api/arena/${path}`, {
    method,
    headers: {
      cookie,
      origin,
      "content-type": "application/json",
      "X-Arena-Protocol": "3",
      "x-forwarded-for": address,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeAll(() => {
  if (
    process.env.DATABASE_URL !==
    "postgresql://postgres@127.0.0.1:54329/gta_h3_test"
  )
    throw new Error("Isolated local database required");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await prisma.arenaRoom.deleteMany({ where: { id: { in: rooms } } });
  await prisma.$disconnect();
});

describe("anonymous screen HTTP boundary", () => {
  it("uses a secure cookie, signs exact room rights and never grants an account identity", async () => {
    const created = await POST(
      request("POST", {
        action: "create",
        zone: "rhenen",
        joinNonce: randomUUID(),
      }),
    );
    expect(created.status).toBe(200);
    const { ticket }: { ticket: ArenaRoomTicket } = await created.json();
    rooms.push(ticket.roomId);
    const setCookie = created.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=strict/i);
    const cookie = setCookie.split(";")[0]!;
    const key = cookie.slice(cookie.indexOf("=") + 1);
    expect(JSON.stringify(ticket)).not.toContain(key);
    const member = await prisma.arenaRoomMember.findUniqueOrThrow({
      where: { id: ticket.memberId },
    });
    expect(member.userId).toBeNull();
    expect(member.displayKeyHash).not.toBe(key);
    const heartbeat = await PATCH(
      request(
        "PATCH",
        { action: "heartbeat", memberId: ticket.memberId, visible: true },
        cookie,
      ),
    );
    expect(heartbeat.status).toBe(200);
    const active = (await heartbeat.json()).ticket as ArenaRoomTicket;
    vi.stubEnv("ABLY_API_KEY", "test.key:local-screen-test-secret");
    const token = await GET(
      request(
        "GET",
        undefined,
        cookie,
        `display-token?memberId=${ticket.memberId}`,
      ),
    );
    expect(token.status).toBe(200);
    expect(token.headers.get("cache-control")).toBe("no-store");
    const payload = await token.json();
    const channels = arenaChannels(active.roomId, active.epoch);
    expect(JSON.parse(payload.tokenRequest.capability)).toEqual({
      [channels.presence]: ["presence", "subscribe"],
      [channels.state]: ["publish", "subscribe"],
      [channels.inputs]: ["subscribe"],
    });
    expect(JSON.stringify(payload)).not.toContain("local-screen-test-secret");
    expect(
      (
        await playerToken(
          request(
            "GET",
            undefined,
            cookie,
            `realtime-token?memberId=${ticket.memberId}`,
          ),
        )
      ).status,
    ).toBe(401);
    expect(
      (await displayMatch(request("POST", {}, "", "display-matches"))).status,
    ).toBe(401);
    const forged = `${ARENA_DISPLAY_COOKIE}=${createArenaDisplayKey()}`;
    expect(
      (
        await PATCH(
          request(
            "PATCH",
            { action: "leave", memberId: ticket.memberId },
            forged,
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await GET(
          request(
            "GET",
            undefined,
            forged,
            `display-token?memberId=${ticket.memberId}`,
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await PATCH(
          request(
            "PATCH",
            { action: "leave", memberId: ticket.memberId },
            cookie,
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await GET(
          request(
            "GET",
            undefined,
            cookie,
            `display-token?memberId=${ticket.memberId}`,
          ),
        )
      ).status,
    ).toBe(403);
  });
  it("rejects cross-origin writes and rate-limits attempts before creating rooms", async () => {
    const body = { action: "create", zone: "campus", joinNonce: randomUUID() };
    expect(
      (
        await POST(
          request(
            "POST",
            body,
            "",
            "display-token",
            "https://other.example.test",
          ),
        )
      ).status,
    ).toBe(403);
    let response: Response | undefined;
    for (let attempt = 0; attempt < 21; attempt++)
      response = await POST(
        request(
          "POST",
          {},
          "",
          "display-token",
          "https://arena.example.test",
          "192.0.2.77",
        ),
      );
    expect(response?.status).toBe(429);
    expect(Number(response?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(
      await prisma.arenaRoomMember.count({
        where: { joinNonce: body.joinNonce },
      }),
    ).toBe(0);
  });
});
