/**
 * Rooms: the six-character codes people type to each other, and what joining one means
 * (spec §6.7).
 *
 * Failure reasons are a typed union rather than strings, so this module stays free of UI copy —
 * the Dutch a player reads ("Dit potje bestaat niet meer", "Potje is vol") lives in the component
 * that shows it, and these can be tested without touching it.
 */

import type {
  PresenceData,
  PresenceMember,
  RealtimeTransport,
} from "./transport";

/**
 * The alphabet room codes are drawn from: no I, O, 0 or 1, because a code is read aloud or typed
 * from a photo and those four are what people get wrong.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** How many characters a room code has. */
export const ROOM_CODE_LENGTH = 6;
/** How many people fit in one match (spec §6.7). */
export const ROOM_CAPACITY = 8;

/** Why a join did not happen. */
export type JoinFailure = "room-empty" | "room-full";

/** The outcome of trying to join. */
export type JoinResult =
  { ok: true; members: PresenceMember[] } | { ok: false; reason: JoinFailure };

/**
 * Generates a room code.
 *
 * @param random - The injected source of randomness, so a test can pin the code.
 * @returns Six characters from {@link ROOM_CODE_ALPHABET}.
 */
export function createRoomCode(random: () => number): string {
  let code = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    const at = Math.floor(random() * ROOM_CODE_ALPHABET.length);
    code += ROOM_CODE_ALPHABET[Math.min(at, ROOM_CODE_ALPHABET.length - 1)];
  }
  return code;
}

/**
 * Whether a string could be a room code at all, before a round trip is spent on it.
 *
 * @param code - What the player typed.
 * @returns True when it is the right length and uses only the code alphabet.
 */
export function isRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  return [...code].every((character) => ROOM_CODE_ALPHABET.includes(character));
}

/** The channel a room's messages and presence live on. */
export function roomChannelName(code: string): string {
  return `arena:room:${code}`;
}

/** The channel a room's inputs live on; only the host subscribes to it (spec §6.3). */
export function roomInputChannelName(code: string): string {
  return `arena:room:${code}:inputs`;
}

/**
 * Joins a room, if there is one to join and there is space.
 *
 * A room with nobody present does not exist: codes are generated client-side and never registered
 * anywhere, so presence is the only thing that says a match is running (spec §6.7).
 *
 * @param transport - This client's connection.
 * @param code - The room code the player typed.
 * @param data - What to announce about this member.
 * @returns Whether the join happened, and who was already there.
 */
export async function joinRoom(
  transport: RealtimeTransport,
  code: string,
  data: PresenceData,
): Promise<JoinResult> {
  const channel = transport.channel(roomChannelName(code));
  const members = await channel.presence.get();
  if (members.length === 0) return { ok: false, reason: "room-empty" };
  if (members.length >= ROOM_CAPACITY)
    return { ok: false, reason: "room-full" };
  await channel.presence.enter(data);
  return { ok: true, members: await channel.presence.get() };
}

/**
 * Opens a new room by being its first member.
 *
 * @param transport - This client's connection.
 * @param code - The code to open, normally from {@link createRoomCode}.
 * @param data - What to announce about this member.
 * @returns The presence set, which is this member alone.
 */
export async function openRoom(
  transport: RealtimeTransport,
  code: string,
  data: PresenceData,
): Promise<PresenceMember[]> {
  const channel = transport.channel(roomChannelName(code));
  await channel.presence.enter(data);
  return channel.presence.get();
}

/**
 * Leaves a room.
 *
 * @param transport - This client's connection.
 * @param code - The room to leave.
 */
export async function leaveRoom(
  transport: RealtimeTransport,
  code: string,
): Promise<void> {
  const channel = transport.channel(roomChannelName(code));
  await channel.presence.leave();
  await channel.detach();
}
