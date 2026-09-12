import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  arenaTokenCapability,
  authorizeArenaToken,
  commandArenaRoom,
} from "../../src/lib/services/arenaRoomService";
import {
  ROOM_RULES,
  arenaChannels,
  type ArenaRoomTicket,
} from "../../src/lib/cityArena/net/roomProtocol";
import type { ArenaUser } from "../../src/lib/arenaAuth";
import { recordMatch } from "../../src/lib/services/arenaMatchService";

const createdRooms: string[] = [];
const createdUsers: string[] = [];
const user = (id: string): ArenaUser => ({
  userId: `arena-test-${id}-${randomUUID()}`,
  displayName: id,
});
const at = new Date("2026-09-12T18:40:00.000Z");
const after = (milliseconds: number): Date =>
  new Date(at.getTime() + milliseconds);

async function create(host: ArenaUser): Promise<ArenaRoomTicket> {
  const ticket = await commandArenaRoom(
    host,
    { action: "create", zone: "campus", joinNonce: randomUUID() },
    at,
  );
  if (!ticket) throw new Error("Expected a room ticket");
  createdRooms.push(ticket.roomId);
  return ticket;
}

describe("PostgreSQL arena authority", () => {
  beforeEach(() => {
    if (
      process.env.DATABASE_URL !==
      "postgresql://postgres@127.0.0.1:54329/gta_h3_test"
    )
      throw new Error(
        "Arena integration tests require the isolated loopback database",
      );
  });

  afterAll(async () => {
    await prisma.arenaRoom.deleteMany({ where: { id: { in: createdRooms } } });
    await prisma.arenaMatch.deleteMany({
      where: { hostUserId: { in: createdUsers } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    await prisma.$disconnect();
  });

  it("serializes simultaneous joins and rejects the ninth player", async () => {
    const host = user("host");
    const room = await create(host);
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        commandArenaRoom(
          user(`join-${index}`),
          { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
          at,
        ),
      ),
    );
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(7);
    expect(
      attempts.filter((result) => result.status === "rejected"),
    ).toHaveLength(3);
    const refreshed = await commandArenaRoom(
      host,
      { action: "heartbeat", memberId: room.memberId, visible: true },
      after(1000),
    );
    expect(refreshed?.members).toHaveLength(8);
    expect(refreshed?.hostClientId).toBe(room.memberId);
  });

  it("does not let another account use a known membership identifier", async () => {
    const host = user("host");
    const room = await create(host);
    await expect(
      authorizeArenaToken(user("intruder").userId, room.memberId, at),
    ).rejects.toMatchObject({ reason: "not-member", status: 403 });
    await expect(
      commandArenaRoom(
        user("intruder"),
        { action: "heartbeat", memberId: room.memberId, visible: true },
        at,
      ),
    ).rejects.toMatchObject({ reason: "not-member" });
  });

  it("grants exact channels and only the host may publish state", async () => {
    const host = user("host");
    const room = await create(host);
    const guest = user("guest");
    const joined = await commandArenaRoom(
      guest,
      { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
      at,
    );
    const ticket = await authorizeArenaToken(
      guest.userId,
      joined!.memberId,
      at,
    );
    const channels = arenaChannels(room.roomId, room.epoch);
    expect(arenaTokenCapability(ticket)[channels.state]).toEqual(["subscribe"]);
    expect(arenaTokenCapability(room)[channels.state]).toContain("publish");
    expect(Object.keys(arenaTokenCapability(ticket))).toHaveLength(3);
    expect(
      Object.keys(arenaTokenCapability(ticket)).every(
        (name) =>
          name.startsWith(`arena:v2:${room.roomId}:`) && !name.includes("*"),
      ),
    ).toBe(true);
  });

  it("migrates an expired host lease and refuses the stale epoch", async () => {
    const host = user("host");
    const room = await create(host);
    const guest = user("guest");
    const joined = await commandArenaRoom(
      guest,
      { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
      after(1000),
    );
    const migrated = await commandArenaRoom(
      guest,
      { action: "heartbeat", memberId: joined!.memberId, visible: true },
      after(ROOM_RULES.hostLeaseMs + 1),
    );
    expect(migrated?.hostClientId).toBe(joined!.memberId);
    expect(migrated?.epoch).toBe(room.epoch + 1);
    expect(arenaChannels(migrated!.roomId, migrated!.epoch).state).not.toBe(
      arenaChannels(room.roomId, room.epoch).state,
    );
    await expect(
      commandArenaRoom(
        host,
        { action: "start", memberId: room.memberId, epoch: room.epoch },
        after(ROOM_RULES.hostLeaseMs + 2),
      ),
    ).rejects.toMatchObject({ reason: "not-host" });
    expect(
      await prisma.arenaHostChange.count({ where: { roomId: room.roomId } }),
    ).toBe(2);
  });

  it("releases a hidden host to a visible member and preserves the round", async () => {
    const host = user("host");
    const room = await create(host);
    const guest = user("guest");
    const joined = await commandArenaRoom(
      guest,
      { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
      at,
    );
    const started = await commandArenaRoom(
      host,
      { action: "start", memberId: room.memberId, epoch: room.epoch },
      at,
    );
    const migrated = await commandArenaRoom(
      host,
      { action: "heartbeat", memberId: room.memberId, visible: false },
      after(500),
    );
    expect(migrated?.hostClientId).toBe(joined!.memberId);
    expect(migrated?.round?.id).toBe(started!.round!.id);
    expect(
      await prisma.arenaRoundParticipant.count({
        where: { roundId: started!.round!.id },
      }),
    ).toBe(2);
    await commandArenaRoom(
      host,
      { action: "leave", memberId: room.memberId },
      after(600),
    );
    await expect(
      authorizeArenaToken(host.userId, room.memberId, after(700)),
    ).rejects.toMatchObject({ reason: "not-member" });
    expect(
      await prisma.arenaRoundParticipant.count({
        where: { roundId: started!.round!.id },
      }),
    ).toBe(2);
  });

  it("retries create and start without duplicating rooms or rounds", async () => {
    const host = user("host");
    const joinNonce = randomUUID();
    const created = await Promise.all(
      Array.from({ length: 3 }, () =>
        commandArenaRoom(
          host,
          { action: "create", zone: "campus", joinNonce },
          at,
        ),
      ),
    );
    const room = created[0]!;
    createdRooms.push(room.roomId);
    expect(new Set(created.map((ticket) => ticket!.roomId)).size).toBe(1);
    const started = await Promise.all(
      Array.from({ length: 3 }, () =>
        commandArenaRoom(
          host,
          { action: "start", memberId: room.memberId, epoch: room.epoch },
          at,
        ),
      ),
    );
    expect(new Set(started.map((ticket) => ticket!.round!.id)).size).toBe(1);
  });

  it("reuses a returning round participant's identity with a new join nonce", async () => {
    const host = user("returning");
    const room = await create(host);
    const peer = user("remaining");
    await commandArenaRoom(
      peer,
      { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
      at,
    );
    const started = await commandArenaRoom(
      host,
      { action: "start", memberId: room.memberId, epoch: room.epoch },
      at,
    );
    await commandArenaRoom(
      host,
      { action: "leave", memberId: room.memberId },
      after(1000),
    );
    const resumed = await commandArenaRoom(
      host,
      { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
      after(2000),
    );
    expect(resumed?.memberId).toBe(room.memberId);
    expect(resumed?.round?.id).toBe(started?.round?.id);
    expect(resumed?.members).toHaveLength(2);
    expect(
      await prisma.arenaRoundParticipant.count({
        where: { roundId: started!.round!.id },
      }),
    ).toBe(2);
  });

  it("refuses an expired membership retry when its place has been filled", async () => {
    const host = user("expired");
    const nonce = randomUUID();
    const room = (await commandArenaRoom(
      host,
      { action: "create", zone: "campus", joinNonce: nonce },
      at,
    ))!;
    createdRooms.push(room.roomId);
    const remaining = user("remaining");
    const peer = (await commandArenaRoom(
      remaining,
      { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
      after(1000),
    ))!;
    await commandArenaRoom(
      remaining,
      { action: "heartbeat", memberId: peer.memberId, visible: true },
      after(20000),
    );
    for (let i = 0; i < 7; i++)
      await commandArenaRoom(
        user(`fill-${i}`),
        { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
        after(21000),
      );
    await expect(
      commandArenaRoom(
        host,
        { action: "create", zone: "campus", joinNonce: nonce },
        after(22000),
      ),
    ).rejects.toMatchObject({ reason: "room-full" });
    await expect(
      commandArenaRoom(
        host,
        { action: "heartbeat", memberId: room.memberId, visible: true },
        after(22000),
      ),
    ).rejects.toMatchObject({ reason: "room-full" });
  });

  it("accepts one result after the server duration, including a departed participant", async () => {
    const host = user("host");
    const guest = user("guest");
    createdUsers.push(host.userId, guest.userId);
    await prisma.user.createMany({
      data: [host, guest].map((entry) => ({
        id: entry.userId,
        firstName: entry.displayName,
        lastName: "Test",
      })),
    });
    const room = await create(host);
    const joined = await commandArenaRoom(
      guest,
      { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
      at,
    );
    const started = await commandArenaRoom(
      host,
      { action: "start", memberId: room.memberId, epoch: room.epoch },
      at,
    );
    const input = {
      roundId: started!.round!.id,
      memberId: room.memberId,
      epoch: room.epoch,
      results: [
        { memberId: room.memberId, kills: 3, deaths: 1, won: true },
        { memberId: joined!.memberId, kills: 1, deaths: 3, won: false },
      ],
    };
    await expect(
      recordMatch(host.userId, input, after(1000)),
    ).rejects.toMatchObject({ reason: "invalid-duration" });
    await commandArenaRoom(
      guest,
      { action: "leave", memberId: joined!.memberId },
      after(1500),
    );
    const end = ROOM_RULES.countdownMs + ROOM_RULES.matchMs;
    const renewed = await commandArenaRoom(
      host,
      { action: "heartbeat", memberId: room.memberId, visible: true },
      after(end),
    );
    input.epoch = renewed!.epoch;
    await expect(
      commandArenaRoom(
        user("too-late"),
        { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
        after(end),
      ),
    ).rejects.toMatchObject({ reason: "round-in-progress" });
    await expect(
      recordMatch(
        host.userId,
        { ...input, results: [input.results[0]!] },
        after(end),
      ),
    ).rejects.toMatchObject({ reason: "invalid-roster" });
    await expect(
      recordMatch(
        host.userId,
        { ...input, results: [input.results[0]!, input.results[0]!] },
        after(end),
      ),
    ).rejects.toThrow();
    await expect(
      recordMatch(
        host.userId,
        {
          ...input,
          results: input.results.map((entry) => ({ ...entry, won: true })),
        },
        after(end),
      ),
    ).rejects.toMatchObject({ reason: "invalid-winner" });
    const saved = await Promise.all([
      recordMatch(host.userId, input, after(end)),
      recordMatch(host.userId, input, after(end)),
    ]);
    expect(saved[0]).toEqual(saved[1]);
    expect(saved[0].recorded).toBe(2);
    const match = await prisma.arenaMatch.findUnique({
      where: { roundId: input.roundId },
      include: { results: true },
    });
    expect(match?.results.map((entry) => entry.userId).sort()).toEqual(
      [host.userId, guest.userId].sort(),
    );
    expect(match?.startedAt.getTime()).toBe(started!.round!.startedAt);
    expect(match?.endedAt.getTime()).toBe(started!.round!.finishesAt);
    expect(match?.verification).toBe("host-reported");
    expect(
      await prisma.arenaMatch.count({ where: { roundId: input.roundId } }),
    ).toBe(1);
  });

  it("completes solo practice without recording leaderboard scores", async () => {
    const host = user("practice");
    const room = await create(host);
    const started = await commandArenaRoom(
      host,
      { action: "start", memberId: room.memberId, epoch: room.epoch },
      at,
    );
    const end = ROOM_RULES.countdownMs + ROOM_RULES.matchMs;
    const renewed = await commandArenaRoom(
      host,
      { action: "heartbeat", memberId: room.memberId, visible: true },
      after(end),
    );
    expect(
      await recordMatch(
        host.userId,
        {
          roundId: started!.round!.id,
          memberId: room.memberId,
          epoch: renewed!.epoch,
          results: [
            { memberId: room.memberId, kills: 0, deaths: 0, won: false },
          ],
        },
        after(end),
      ),
    ).toEqual({ matchId: null, recorded: 0, verification: "host-reported" });
    const rematch = await commandArenaRoom(
      host,
      { action: "start", memberId: room.memberId, epoch: renewed!.epoch },
      after(end + 1000),
    );
    expect(rematch?.round?.id).not.toBe(started?.round?.id);
  });
});
