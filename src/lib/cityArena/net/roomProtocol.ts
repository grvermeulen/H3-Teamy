import { z } from "zod";

/** Server time windows for room liveness and channel authorization. */
export const ROOM_RULES = {
  heartbeatMs: 3000,
  memberTtlMs: 20_000,
  hostLeaseMs: 12_000,
  tokenTtlMs: 60_000,
  roomTtlMs: 2 * 60 * 60 * 1000,
  countdownMs: 3000,
  matchMs: 180_000,
  completionGraceMs: 5 * 60 * 1000,
  capacity: 8,
} as const;

/** Codes are locators; membership and host authority are checked separately. */
export const ArenaRoomCodeSchema = z
  .string()
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
/** Supported arena districts. */
export const ArenaZoneSchema = z.enum([
  "rhenen",
  "wageningen",
  "campus",
  "bennekom",
]);
const member = { memberId: z.uuid() };

/** Every room mutation is scoped to a verified account on the server. */
export const ArenaRoomCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      zone: ArenaZoneSchema,
      joinNonce: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("join"),
      roomCode: ArenaRoomCodeSchema,
      joinNonce: z.uuid(),
    })
    .strict(),
  z
    .object({ action: z.literal("heartbeat"), ...member, visible: z.boolean() })
    .strict(),
  z.object({ action: z.literal("leave"), ...member }).strict(),
  z
    .object({
      action: z.literal("start"),
      ...member,
      epoch: z.number().int().positive(),
    })
    .strict(),
]);

/** Validated commands accepted by the room service. */
export type ArenaRoomCommand = z.infer<typeof ArenaRoomCommandSchema>;

/** The authoritative room view returned to an authenticated member. */
export const ArenaRoomTicketSchema = z.object({
  roomId: z.uuid(),
  roomCode: ArenaRoomCodeSchema,
  zone: ArenaZoneSchema,
  memberId: z.uuid(),
  hostClientId: z.uuid().nullable(),
  epoch: z.number().int().positive(),
  leaseUntil: z.number(),
  serverTime: z.number(),
  members: z
    .array(
      z.object({
        clientId: z.uuid(),
        name: z.string().max(40),
        joinedAt: z.number(),
      }),
    )
    .max(8),
  round: z
    .object({
      id: z.uuid(),
      startedAt: z.number(),
      finishesAt: z.number(),
      completedAt: z.number().nullable(),
    })
    .nullable(),
});

/** Client identity and the epoch in which it may exchange state. */
export type ArenaRoomTicket = z.infer<typeof ArenaRoomTicketSchema>;

/** Physical Ably channels; old arena:room:* credentials cannot address this namespace. */
export function arenaChannels(
  roomId: string,
  epoch: number,
): { state: string; inputs: string; presence: string } {
  const prefix = `arena:v2:${roomId}`;
  return {
    state: `${prefix}:${epoch}:state`,
    inputs: `${prefix}:${epoch}:inputs`,
    presence: `${prefix}:presence`,
  };
}
