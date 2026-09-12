import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: session }));
vi.mock("../../src/lib/authOptions", () => ({ authOptions: {} }));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));
import { prisma } from "../../src/lib/db";
import { POST as sessionPost } from "../../src/app/api/arena/session/route";
import { POST as matchPost } from "../../src/app/api/arena/matches/route";
import { GET as tokenGet } from "../../src/app/api/arena/realtime-token/route";
import {
  arenaChannels,
  type ArenaRoomTicket,
} from "../../src/lib/cityArena/net/roomProtocol";

const accountId = `arena-api-test-${randomUUID()}`;
const roomIds: string[] = [];
function request(path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/arena/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie: `anon_id=${accountId}`,
      origin: "http://localhost",
      "Content-Type": "application/json",
      "x-forwarded-for": "127.0.0.1",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("arena routes with the actual auth helper and PostgreSQL service", () => {
  beforeAll(async () => {
    if (
      process.env.DATABASE_URL !==
      "postgresql://postgres@127.0.0.1:54329/gta_h3_test"
    )
      throw new Error("Local arena database required");
    await prisma.user.create({
      data: { id: accountId, firstName: "Guido", lastName: "Test" },
    });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    session.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.arenaRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.user.delete({ where: { id: accountId } });
    await prisma.$disconnect();
  });
  it("rejects a forged account cookie on every multiplayer write/token route", async () => {
    const identities = await prisma.identity.count();
    const users = await prisma.user.count();
    expect((await tokenGet(request("realtime-token"))).status).toBe(401);
    expect(
      (
        await sessionPost(
          request("session", {
            action: "create",
            zone: "campus",
            joinNonce: randomUUID(),
          }),
        )
      ).status,
    ).toBe(401);
    expect((await matchPost(request("matches", {}))).status).toBe(401);
    expect(await prisma.identity.count()).toBe(identities);
    expect(await prisma.user.count()).toBe(users);
    expect(
      await prisma.arenaRoomMember.count({ where: { userId: accountId } }),
    ).toBe(0);
  });
  it("creates a seat for the session account and signs only its exact channels", async () => {
    session.mockResolvedValue({ user: { id: accountId } });
    const response = await sessionPost(
      request("session", {
        action: "create",
        zone: "campus",
        joinNonce: randomUUID(),
      }),
    );
    expect(response.status).toBe(200);
    const { ticket }: { ticket: ArenaRoomTicket } = await response.json();
    roomIds.push(ticket.roomId);
    vi.stubEnv("ABLY_API_KEY", "test.key:local-test-secret");
    const token = await tokenGet(
      request(`realtime-token?memberId=${ticket.memberId}`),
    );
    expect(token.status).toBe(200);
    const body = await token.json();
    expect(body.clientId).toBe(ticket.memberId);
    expect(body.clientId).not.toBe(accountId);
    const channels = arenaChannels(ticket.roomId, ticket.epoch);
    expect(JSON.parse(body.tokenRequest.capability)).toEqual({
      [channels.presence]: ["presence", "subscribe"],
      [channels.state]: ["publish", "subscribe"],
      [channels.inputs]: ["publish", "subscribe"],
    });
    expect(body.tokenRequest.mac).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("local-test-secret");
    expect(
      (
        await sessionPost(
          request("session", { action: "leave", memberId: ticket.memberId }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await tokenGet(request(`realtime-token?memberId=${ticket.memberId}`)))
        .status,
    ).toBe(403);
  });
});
