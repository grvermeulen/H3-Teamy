/**
 * The control and event payloads (spec §6.3).
 *
 * Unlike inputs and snapshots these are not hot-path, so they stay readable objects and are
 * validated on receipt. That validation is the point: a malformed message from a peer — an old
 * client, a replayed frame, someone poking the channel — must never throw inside the host loop.
 * Every reader parses with {@link parseControl} or {@link parseArenaEvent} and drops what fails.
 */

import { z } from "zod";

/** The four zones a match can be played in (spec §16). */
const ZoneKeySchema = z.enum(["rhenen", "wageningen", "campus", "bennekom"]);

/** `start`: the host opening a match, with the seed every client simulates from. */
const StartSchema = z.object({
  kind: z.literal("start"),
  zone: ZoneKeySchema,
  seed: z.number().int(),
  startsAtTick: z.number().int().nonnegative(),
});

/** `zone`: the host moving the match to another zone. */
const ZoneSchema = z.object({
  kind: z.literal("zone"),
  zone: ZoneKeySchema,
});

/** `join`: a late member asking the host to spawn them. */
const JoinSchema = z.object({ kind: z.literal("join") });

/** `leave`: a member bowing out before their presence drops. */
const LeaveSchema = z.object({ kind: z.literal("leave") });

/** Everything a member may send on the room's control channel. */
export const ControlSchema = z.discriminatedUnion("kind", [
  StartSchema,
  ZoneSchema,
  JoinSchema,
  LeaveSchema,
]);

/** One control message. */
export type ControlMessage = z.infer<typeof ControlSchema>;

/** Events the host broadcasts, driving sound, haptics and the HUD (spec §6.3). */
export const ArenaEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("kill"),
    killer: z.number().int().nullable(),
    victim: z.number().int(),
    weapon: z.enum(["fist", "pistol", "uzi", "shotgun"]),
  }),
  z.object({
    kind: z.literal("explosion"),
    x: z.number(),
    y: z.number(),
  }),
  z.object({
    kind: z.literal("pickup"),
    id: z.number().int(),
    by: z.number().int(),
  }),
  z.object({
    kind: z.literal("wanted"),
    player: z.number().int(),
    level: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("phase"), phase: z.string() }),
  z.object({
    kind: z.literal("join"),
    id: z.number().int(),
    name: z.string(),
    colour: z.string(),
  }),
  z.object({ kind: z.literal("leave"), id: z.number().int() }),
  z.object({ kind: z.literal("hostChanged"), id: z.string() }),
  z.object({
    kind: z.literal("damage"),
    victim: z.number().int(),
    total: z.number(),
    source: z.enum(["bullet", "explosion", "impact", "fall"]),
  }),
]);

/** One broadcast event. */
export type ArenaNetEvent = z.infer<typeof ArenaEventSchema>;

/**
 * Parses a control message received from a peer.
 *
 * @param data - The raw payload, which may be anything at all.
 * @returns The message, or `null` when it does not validate.
 */
export function parseControl(data: unknown): ControlMessage | null {
  const parsed = ControlSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * Parses an event received from the host.
 *
 * @param data - The raw payload, which may be anything at all.
 * @returns The event, or `null` when it does not validate.
 */
export function parseArenaEvent(data: unknown): ArenaNetEvent | null {
  const parsed = ArenaEventSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
