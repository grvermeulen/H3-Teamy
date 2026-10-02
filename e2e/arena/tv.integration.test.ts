import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/db";
import {
  arenaDisplayIdentity,
  createArenaDisplayKey,
} from "../../src/lib/arenaDisplayIdentity";
import {
  arenaTokenCapability,
  authorizeArenaToken,
  commandArenaRoom,
  type ArenaActor,
} from "../../src/lib/services/arenaRoomService";
import {
  arenaChannels,
  ROOM_RULES,
  type ArenaRoomTicket,
} from "../../src/lib/cityArena/net/roomProtocol";
import { recordMatch } from "../../src/lib/services/arenaMatchService";

const roomIds: string[] = [];
const userIds: string[] = [];
const roundIds: string[] = [];
const at = new Date("2026-09-13T08:00:00.000Z");
const after = (ms: number) => new Date(at.getTime() + ms);
const screenActor = (): ArenaActor => ({
  userId: null,
  displayName: "Scherm",
  ...arenaDisplayIdentity(createArenaDisplayKey())!,
});
const account = (): ArenaActor => ({
  userId: `tv-test-${randomUUID()}`,
  displayName: "Speler",
});

async function open(actor: ArenaActor): Promise<ArenaRoomTicket> {
  const ticket = (await commandArenaRoom(
    actor,
    { action: "create", zone: "rhenen", joinNonce: randomUUID() },
    at,
  ))!;
  roomIds.push(ticket.roomId);
  return ticket;
}

describe("TV membership and authority on PostgreSQL", () => {
  beforeEach(() => {
    if (
      process.env.DATABASE_URL !==
      "postgresql://postgres@127.0.0.1:54329/gta_h3_test"
    )
      throw new Error("Only the disposable local database is allowed");
  });
  afterAll(async () => {
    await prisma.arenaMatch.deleteMany({
      where: { roundId: { in: roundIds } },
    });
    await prisma.arenaRoom.deleteMany({ where: { id: { in: roomIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("allows eight account seats plus two screens, with concurrent joins bounded", async () => {
    const display = screenActor();
    const room = await open(display);
    const joins = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        commandArenaRoom(
          account(),
          {
            action: "join",
            roomCode: room.roomCode,
            joinNonce: randomUUID(),
            role: "controller",
          },
          at,
        ),
      ),
    );
    expect(
      joins.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(8);
    await commandArenaRoom(
      screenActor(),
      { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
      at,
    );
    await expect(
      commandArenaRoom(
        screenActor(),
        { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
        at,
      ),
    ).rejects.toMatchObject({ reason: "room-full" });
    const refreshed = (await commandArenaRoom(
      display,
      { action: "heartbeat", memberId: room.memberId, visible: true },
      after(1000),
    ))!;
    expect(refreshed.members).toHaveLength(10);
    expect(refreshed.hostClientId).toBe(room.memberId);
  });

  it("refuses guessed member IDs, other screen cookies and player/display cross-use", async () => {
    const display = screenActor();
    const room = await open(display);
    const player = account();
    const joined = (await commandArenaRoom(
      player,
      { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
      at,
    ))!;
    await expect(
      authorizeArenaToken(
        screenActor() as Extract<ArenaActor, { userId: null }>,
        room.memberId,
        at,
      ),
    ).rejects.toMatchObject({ reason: "not-member" });
    await expect(
      authorizeArenaToken(player.userId!, room.memberId, at),
    ).rejects.toMatchObject({ reason: "not-member" });
    await expect(
      authorizeArenaToken(
        display as Extract<ArenaActor, { userId: null }>,
        joined.memberId,
        at,
      ),
    ).rejects.toMatchObject({ reason: "not-member" });
    await expect(
      commandArenaRoom(
        screenActor(),
        { action: "leave", memberId: room.memberId },
        at,
      ),
    ).rejects.toMatchObject({ reason: "not-member" });
  });

  it("never grants screen input publication, account identity or wildcard channels", async () => {
    const display = screenActor();
    const room = await open(display);
    const active = (await commandArenaRoom(
      display,
      { action: "heartbeat", memberId: room.memberId, visible: true },
      after(1),
    ))!;
    const channels = arenaChannels(active.roomId, active.epoch);
    const rights = arenaTokenCapability(active);
    expect(rights[channels.inputs]).toEqual(["subscribe"]);
    expect(rights[channels.state]).toContain("publish");
    expect(
      Object.keys(rights).every(
        (key) =>
          key.startsWith(`arena:v2:${room.roomId}:`) && !key.includes("*"),
      ),
    ).toBe(true);
    const member = await prisma.arenaRoomMember.findUniqueOrThrow({
      where: { id: room.memberId },
    });
    expect(member.userId).toBeNull();
    const second = (await commandArenaRoom(
      screenActor(),
      { action: "join", roomCode: room.roomCode, joinNonce: randomUUID() },
      after(2),
    ))!;
    expect(arenaTokenCapability(second)[channels.inputs]).toBeUndefined();
    expect(arenaTokenCapability(second)[channels.state]).toEqual(["subscribe"]);
  });

  it("elects visible display, then desktop, then mobile, never a controller", async () => {
    const display = screenActor();
    const room = await open(display);
    const controller = account();
    const mobile = account();
    const desktop = account();
    const join = async (
      actor: ArenaActor,
      role: "player" | "controller",
      device: "desktop" | "mobile",
    ) =>
      (await commandArenaRoom(
        actor,
        {
          action: "join",
          roomCode: room.roomCode,
          joinNonce: randomUUID(),
          role,
          device,
        },
        at,
      ))!;
    const controlTicket = await join(controller, "controller", "desktop");
    expect(controlTicket.hostClientId).toBeNull();
    await commandArenaRoom(
      display,
      { action: "heartbeat", memberId: room.memberId, visible: true },
      after(1),
    );
    const mobileTicket = await join(mobile, "player", "mobile");
    const desktopTicket = await join(desktop, "player", "desktop");
    const hidden = (await commandArenaRoom(
      display,
      { action: "heartbeat", memberId: room.memberId, visible: false },
      after(1000),
    ))!;
    expect(hidden.hostClientId).toBe(desktopTicket.memberId);
    await commandArenaRoom(
      desktop,
      { action: "leave", memberId: desktopTicket.memberId },
      after(1001),
    );
    const mobileHost = (await commandArenaRoom(
      mobile,
      { action: "heartbeat", memberId: mobileTicket.memberId, visible: true },
      after(1002),
    ))!;
    expect(mobileHost.hostClientId).toBe(mobileTicket.memberId);
    await commandArenaRoom(
      mobile,
      { action: "leave", memberId: mobileTicket.memberId },
      after(1003),
    );
    const waiting = (await commandArenaRoom(
      controller,
      { action: "heartbeat", memberId: controlTicket.memberId, visible: true },
      after(1004),
    ))!;
    expect(waiting.hostClientId).toBeNull();
  });

  it("records an anonymous-hosted round with only authenticated players, exactly once", async () => {
    const display = screenActor();
    const room = await open(display);
    const players = [account(), account()];
    for (const player of players) {
      await prisma.user.create({
        data: {
          id: player.userId!,
          email: `${player.userId}@example.test`,
          firstName: "Test",
          lastName: "TV",
        },
      });
      userIds.push(player.userId!);
      await commandArenaRoom(
        player,
        {
          action: "join",
          roomCode: room.roomCode,
          joinNonce: randomUUID(),
          role: "controller",
        },
        at,
      );
    }
    const hosted = (await commandArenaRoom(
      display,
      { action: "heartbeat", memberId: room.memberId, visible: true },
      after(1),
    ))!;
    const started = (await commandArenaRoom(
      display,
      { action: "start", memberId: room.memberId, epoch: hosted.epoch },
      after(2),
    ))!;
    roundIds.push(started.round!.id);
    const participants = await prisma.arenaRoundParticipant.findMany({
      where: { roundId: started.round!.id },
    });
    expect(participants).toHaveLength(2);
    expect(participants.map((entry) => entry.memberId)).not.toContain(
      room.memberId,
    );
    const finish = new Date(started.round!.finishesAt + 1);
    for (const member of started.members.filter(
      (entry) => entry.role !== "display",
    )) {
      await prisma.arenaRoomMember.update({
        where: { id: member.clientId },
        data: { seenAt: finish },
      });
    }
    const resumed = (await commandArenaRoom(
      display,
      { action: "heartbeat", memberId: room.memberId, visible: true },
      finish,
    ))!;
    const body = {
      roundId: started.round!.id,
      memberId: room.memberId,
      epoch: resumed.epoch,
      results: participants.map((member) => ({
        memberId: member.memberId,
        kills: 0,
        deaths: 0,
        won: false,
      })),
    };
    const first = await recordMatch(
      display as Extract<ArenaActor, { userId: null }>,
      body,
      finish,
    );
    expect(first.recorded).toBe(2);
    expect(
      await recordMatch(
        display as Extract<ArenaActor, { userId: null }>,
        body,
        finish,
      ),
    ).toEqual(first);
    const match = await prisma.arenaMatch.findUniqueOrThrow({
      where: { id: first.matchId! },
    });
    expect(match.hostUserId).toBeNull();
  });

  it("refuses an expired or left screen membership", async () => {
    const display = screenActor();
    const room = await open(display);
    await expect(
      authorizeArenaToken(
        display as Extract<ArenaActor, { userId: null }>,
        room.memberId,
        after(ROOM_RULES.memberTtlMs + 1),
      ),
    ).rejects.toMatchObject({ reason: "membership-expired" });
    await commandArenaRoom(
      display,
      { action: "leave", memberId: room.memberId },
      after(1),
    );
    await expect(
      authorizeArenaToken(
        display as Extract<ArenaActor, { userId: null }>,
        room.memberId,
        after(2),
      ),
    ).rejects.toMatchObject({ reason: "not-member" });
  });
});
