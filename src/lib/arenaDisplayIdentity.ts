import { createHash, randomBytes } from "node:crypto";

/** Anonymous screen credential; never an H3 account. */
export type ArenaDisplayIdentity = { displayKeyHash: string };
/** Cookie is restricted to arena APIs and never exposed to client JavaScript. */
export const ARENA_DISPLAY_COOKIE = "h3-arena-display";

/** Generates a 256-bit credential for an anonymous screen browser. */
export function createArenaDisplayKey(): string {
  return randomBytes(32).toString("base64url");
}

/** Resolves a credential to the hash kept in room membership rows. */
export function arenaDisplayIdentity(
  key: string | undefined,
): ArenaDisplayIdentity | null {
  if (!key || !/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
  return { displayKeyHash: createHash("sha256").update(key).digest("hex") };
}
