import { randomInt, randomUUID } from "node:crypto";
import { Prisma, type ArenaRoom, type ArenaRoomMember } from "@prisma/client";
import { prisma } from "../db";
import type { ArenaUser } from "../arenaAuth";
import { ROOM_CODE_ALPHABET } from "../cityArena/net/room";
import {
  ArenaZoneSchema,
  ROOM_RULES,
  arenaChannels,
  type ArenaRoomCommand,
  type ArenaRoomTicket,
} from "../cityArena/net/roomProtocol";
import type { LobbyRoom } from "../cityArena/net/lobbyPresence";

/** Expected refusals are returned to players without creating Sentry issues. */
export class ArenaRoomError extends Error {
  constructor(
    public readonly reason: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ArenaRoomError";
  }
}

type Transaction = Prisma.TransactionClient;

/** Locks a room so capacity, host grants and match transitions cannot race. */
export async function lockArenaRoom(
  tx: Transaction,
  roomId: string,
  now: Date,
): Promise<ArenaRoom> {
  await tx.$queryRaw`SELECT "id" FROM "ArenaRoom" WHERE "id" = ${roomId} FOR UPDATE`;
  const room = await tx.arenaRoom.findUnique({ where: { id: roomId } });
  if (!room || room.expiresAt <= now)
    throw new ArenaRoomError("room-empty", 404, "Dit potje bestaat niet meer");
  return room;
}

/** Resolves a session-owned seat; a known room or member ID alone grants no access. */
export async function requireArenaMember(
  tx: Transaction,
  memberId: string,
  userId: string,
): Promise<ArenaRoomMember> {
  const member = await tx.arenaRoomMember.findUnique({
    where: { id: memberId },
  });
  if (!member || member.userId !== userId || member.leftAt !== null) {
    throw new ArenaRoomError(
      "not-member",
      403,
      "Je bent geen deelnemer aan dit potje",
    );
  }
  return member;
}

async function liveMembers(
  tx: Transaction,
  roomId: string,
  now: Date,
): Promise<ArenaRoomMember[]> {
  return tx.arenaRoomMember.findMany({
    where: {
      roomId,
      leftAt: null,
      seenAt: { gt: new Date(now.getTime() - ROOM_RULES.memberTtlMs) },
    },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    take: ROOM_RULES.capacity,
  });
}

async function maintainHost(
  tx: Transaction,
  room: ArenaRoom,
  now: Date,
  renewingMember?: string,
): Promise<ArenaRoom> {
  const members = await liveMembers(tx, room.id, now);
  const current = members.find(
    (member) => member.id === room.hostMemberId && member.visible,
  );
  if (current && room.hostLeaseUntil > now) {
    if (current.id !== renewingMember) return room;
    return tx.arenaRoom.update({
      where: { id: room.id },
      data: {
        hostLeaseUntil: new Date(now.getTime() + ROOM_RULES.hostLeaseMs),
      },
    });
  }
  const next = members.find(
    (member) =>
      member.visible &&
      member.seenAt.getTime() > now.getTime() - ROOM_RULES.hostLeaseMs,
  );
  if (!next && !room.hostMemberId) return room;
  const updated = await tx.arenaRoom.update({
    where: { id: room.id },
    data: {
      hostMemberId: next?.id ?? null,
      hostEpoch: { increment: 1 },
      hostLeaseUntil: new Date(now.getTime() + ROOM_RULES.hostLeaseMs),
    },
  });
  await tx.arenaHostChange.create({
    data: {
      roomId: room.id,
      memberId: updated.hostMemberId,
      epoch: updated.hostEpoch,
    },
  });
  return updated;
}

async function ticketFor(
  tx: Transaction,
  room: ArenaRoom,
  memberId: string,
  now: Date,
): Promise<ArenaRoomTicket> {
  const members = await liveMembers(tx, room.id, now);
  const round = await tx.arenaRound.findFirst({
    where: { roomId: room.id },
    orderBy: { startedAt: "desc" },
  });
  return {
    roomId: room.id,
    roomCode: room.code,
    zone: ArenaZoneSchema.parse(room.zone),
    memberId,
    hostClientId: room.hostMemberId,
    epoch: room.hostEpoch,
    leaseUntil: room.hostLeaseUntil.getTime(),
    serverTime: now.getTime(),
    members: members.map((member) => ({
      clientId: member.id,
      name: member.displayName,
      joinedAt: member.joinedAt.getTime(),
    })),
    round: round
      ? {
          id: round.id,
          startedAt: round.startedAt.getTime(),
          finishesAt: round.finishesAt.getTime(),
          completedAt: round.completedAt?.getTime() ?? null,
        }
      : null,
  };
}

async function activeRound(tx: Transaction, roomId: string, now: Date) {
  const round = await tx.arenaRound.findFirst({
    where: { roomId, completedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!round) return null;
  if (
    round.finishesAt.getTime() + ROOM_RULES.completionGraceMs >=
    now.getTime()
  )
    return round;
  await tx.arenaRound.update({
    where: { id: round.id },
    data: { completedAt: now },
  });
  return null;
}

async function resumeMember(
  tx: Transaction,
  member: ArenaRoomMember,
  now: Date,
): Promise<void> {
  if (member.seenAt.getTime() > now.getTime() - ROOM_RULES.memberTtlMs) return;
  const present = await liveMembers(tx, member.roomId, now);
  if (
    present.length >= ROOM_RULES.capacity ||
    present.some((entry) => entry.userId === member.userId)
  ) {
    throw new ArenaRoomError(
      "room-full",
      409,
      "Je plek is inmiddels bezet, open het potje opnieuw",
    );
  }
  const elsewhere = await tx.arenaRoomMember.count({
    where: {
      userId: member.userId,
      leftAt: null,
      seenAt: { gt: new Date(now.getTime() - ROOM_RULES.memberTtlMs) },
      room: { expiresAt: { gt: now } },
    },
  });
  if (elsewhere >= 2)
    throw new ArenaRoomError(
      "too-many-rooms",
      409,
      "Sluit eerst een ander potje",
    );
  const round = await activeRound(tx, member.roomId, now);
  if (!round) return;
  const roster = await tx.arenaRoundParticipant.findMany({
    where: { roundId: round.id },
  });
  if (roster.some((entry) => entry.memberId === member.id)) return;
  if (
    round.finishesAt <= now ||
    roster.length >= ROOM_RULES.capacity ||
    roster.some((entry) => entry.userId === member.userId)
  ) {
    throw new ArenaRoomError(
      "round-in-progress",
      409,
      "Wacht tot het volgende potje om opnieuw mee te spelen",
    );
  }
  await tx.arenaRoundParticipant.create({
    data: { roundId: round.id, memberId: member.id, userId: member.userId },
  });
}

async function join(
  tx: Transaction,
  user: ArenaUser,
  command: Extract<ArenaRoomCommand, { action: "create" | "join" }>,
  now: Date,
): Promise<ArenaRoomTicket> {
  // A per-account lock bounds concurrent room creation and makes request retries idempotent.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arena:${user.userId}`}))`;
  const previous = await tx.arenaRoomMember.findUnique({
    where: { joinNonce: command.joinNonce },
  });
  if (previous) {
    if (previous.userId !== user.userId || previous.leftAt)
      throw new ArenaRoomError(
        "not-member",
        403,
        "Deze deelname is niet meer geldig",
      );
    const room = await lockArenaRoom(tx, previous.roomId, now);
    const fresh = await requireArenaMember(tx, previous.id, user.userId);
    if (
      (command.action === "join" && room.code !== command.roomCode) ||
      (command.action === "create" && room.zone !== command.zone)
    ) {
      throw new ArenaRoomError("invalid-retry", 409, "Open het potje opnieuw");
    }
    await resumeMember(tx, fresh, now);
    await tx.arenaRoomMember.update({
      where: { id: previous.id },
      data: { seenAt: now },
    });
    return ticketFor(
      tx,
      await maintainHost(tx, room, now, previous.id),
      previous.id,
      now,
    );
  }
  const count = await tx.arenaRoomMember.count({
    where: {
      userId: user.userId,
      leftAt: null,
      seenAt: { gt: new Date(now.getTime() - ROOM_RULES.memberTtlMs) },
      room: { expiresAt: { gt: now } },
    },
  });
  if (count >= 2)
    throw new ArenaRoomError(
      "too-many-rooms",
      409,
      "Sluit eerst een ander potje",
    );
  const memberId = randomUUID();
  let room: ArenaRoom;
  if (command.action === "create") {
    // Keep expired authority records for a week; match history is stored separately.
    const retentionCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    await tx.$executeRaw`DELETE FROM "ArenaRoom" WHERE "id" IN (
      SELECT "id" FROM "ArenaRoom" WHERE "expiresAt" < ${retentionCutoff}
      ORDER BY "expiresAt" LIMIT 25 FOR UPDATE SKIP LOCKED
    )`;
    const code = Array.from(
      { length: 6 },
      () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)],
    ).join("");
    room = await tx.arenaRoom.create({
      data: {
        code,
        zone: command.zone,
        expiresAt: new Date(now.getTime() + ROOM_RULES.roomTtlMs),
        hostMemberId: memberId,
        hostLeaseUntil: new Date(now.getTime() + ROOM_RULES.hostLeaseMs),
      },
    });
    await tx.arenaHostChange.create({
      data: { roomId: room.id, memberId, epoch: room.hostEpoch },
    });
  } else {
    const found = await tx.arenaRoom.findUnique({
      where: { code: command.roomCode },
      select: { id: true },
    });
    if (!found)
      throw new ArenaRoomError(
        "room-empty",
        404,
        "Dit potje bestaat niet meer",
      );
    room = await lockArenaRoom(tx, found.id, now);
    const members = await liveMembers(tx, room.id, now);
    if (members.length === 0)
      throw new ArenaRoomError(
        "room-empty",
        404,
        "Dit potje bestaat niet meer",
      );
    if (members.some((member) => member.userId === user.userId))
      throw new ArenaRoomError(
        "already-joined",
        409,
        "Je speelt al mee in een ander tabblad",
      );
    if (members.length >= ROOM_RULES.capacity)
      throw new ArenaRoomError("room-full", 409, "Potje is vol");
  }
  const round = await activeRound(tx, room.id, now);
  if (round) {
    const roster = await tx.arenaRoundParticipant.findMany({
      where: { roundId: round.id },
    });
    const returning = roster.find((entry) => entry.userId === user.userId);
    if (returning) {
      await tx.arenaRoomMember.update({
        where: { id: returning.memberId },
        data: {
          leftAt: null,
          seenAt: now,
          visible: true,
          joinNonce: command.joinNonce,
        },
      });
      return ticketFor(
        tx,
        await maintainHost(tx, room, now),
        returning.memberId,
        now,
      );
    }
    if (round.finishesAt <= now || roster.length >= ROOM_RULES.capacity) {
      throw new ArenaRoomError(
        "round-in-progress",
        409,
        "Wacht tot het volgende potje om opnieuw mee te spelen",
      );
    }
    await tx.arenaRoundParticipant.create({
      data: { roundId: round.id, memberId, userId: user.userId },
    });
  }
  await tx.arenaRoomMember.create({
    data: {
      id: memberId,
      roomId: room.id,
      userId: user.userId,
      joinNonce: command.joinNonce,
      displayName: user.displayName.slice(0, 40),
      seenAt: now,
    },
  });
  return ticketFor(tx, await maintainHost(tx, room, now), memberId, now);
}

/** Executes a validated room operation under PostgreSQL locks; cache fallback never grants authority. */
export async function commandArenaRoom(
  user: ArenaUser,
  command: ArenaRoomCommand,
  now = new Date(),
): Promise<ArenaRoomTicket | null> {
  return prisma.$transaction(async (tx) => {
    if (command.action === "create" || command.action === "join")
      return join(tx, user, command, now);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arena:${user.userId}`}))`;
    const member = await requireArenaMember(tx, command.memberId, user.userId);
    let room = await lockArenaRoom(tx, member.roomId, now);
    // Recheck after acquiring the room lock: a concurrent leave may have won.
    const fresh = await requireArenaMember(tx, member.id, user.userId);
    if (command.action === "leave") {
      await tx.arenaRoomMember.update({
        where: { id: member.id },
        data: { leftAt: now, visible: false },
      });
      await maintainHost(tx, room, now);
      return null;
    }
    if (command.action === "heartbeat") {
      await resumeMember(tx, fresh, now);
      await tx.arenaRoomMember.update({
        where: { id: member.id },
        data: { seenAt: now, visible: command.visible },
      });
      room = await maintainHost(tx, room, now, member.id);
      return ticketFor(tx, room, member.id, now);
    }
    room = await maintainHost(tx, room, now);
    if (
      room.hostMemberId !== member.id ||
      room.hostEpoch !== command.epoch ||
      room.hostLeaseUntil <= now
    ) {
      throw new ArenaRoomError(
        "not-host",
        403,
        "Alleen de huidige host kan het potje starten",
      );
    }
    const existing = await activeRound(tx, room.id, now);
    if (!existing) {
      const members = await liveMembers(tx, room.id, now);
      const startedAt = new Date(now.getTime() + ROOM_RULES.countdownMs);
      await tx.arenaRound.create({
        data: {
          roomId: room.id,
          startedAt,
          finishesAt: new Date(startedAt.getTime() + ROOM_RULES.matchMs),
          participants: {
            create: members.map((entry) => ({
              memberId: entry.id,
              userId: entry.userId,
            })),
          },
        },
      });
    }
    return ticketFor(tx, room, member.id, now);
  });
}

/** Resolves current membership before issuing a short-lived, operation-specific Ably token. */
export async function authorizeArenaToken(
  userId: string,
  memberId: string,
  now = new Date(),
): Promise<ArenaRoomTicket> {
  return prisma.$transaction(async (tx) => {
    const member = await requireArenaMember(tx, memberId, userId);
    let room = await lockArenaRoom(tx, member.roomId, now);
    const fresh = await requireArenaMember(tx, memberId, userId);
    if (fresh.seenAt.getTime() <= now.getTime() - ROOM_RULES.memberTtlMs)
      throw new ArenaRoomError(
        "membership-expired",
        403,
        "Je verbinding is verlopen, open het potje opnieuw",
      );
    room = await maintainHost(tx, room, now);
    return ticketFor(tx, room, memberId, now);
  });
}

/** No wildcard, lobby advertisement or player permission to publish host state. */
export function arenaTokenCapability(
  ticket: ArenaRoomTicket,
): Record<string, ("publish" | "subscribe" | "presence")[]> {
  const channels = arenaChannels(ticket.roomId, ticket.epoch);
  const isHost = ticket.hostClientId === ticket.memberId;
  return {
    [channels.presence]: ["subscribe", "presence"],
    [channels.state]: isHost ? ["publish", "subscribe"] : ["subscribe"],
    [channels.inputs]: isHost ? ["publish", "subscribe"] : ["publish"],
  };
}

/** Lists bounded, live server-registered rooms without trusting client advertisements. */
export async function listArenaRooms(now = new Date()): Promise<LobbyRoom[]> {
  const rooms = await prisma.arenaRoom.findMany({
    where: {
      expiresAt: { gt: now },
      hostLeaseUntil: { gt: now },
      hostMemberId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      members: {
        where: {
          leftAt: null,
          seenAt: { gt: new Date(now.getTime() - ROOM_RULES.memberTtlMs) },
        },
        take: ROOM_RULES.capacity,
      },
      rounds: { where: { completedAt: null }, take: 1 },
    },
  });
  return rooms.flatMap((room) => {
    const host = room.members.find((member) => member.id === room.hostMemberId);
    if (!host) return [];
    return [
      {
        roomCode: room.code,
        zone: ArenaZoneSchema.parse(room.zone),
        hostName: host.displayName,
        players: room.members.length,
        phase: room.rounds.length ? ("playing" as const) : ("lobby" as const),
      },
    ];
  });
}
