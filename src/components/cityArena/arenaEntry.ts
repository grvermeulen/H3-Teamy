/**
 * How the overlay was opened.
 *
 * The launcher decides which of the three ways in a player took, and the overlay decides what to
 * show for each. Keeping it a discriminated union rather than a bag of optional props means the
 * overlay cannot be handed a "join" with no room code.
 */

import type { ZoneKey } from "@/lib/cityArena/world/mapTypes";

/** The three ways into the arena. */
export type ArenaEntry =
  /** "Nieuw potje": open a fresh room in this zone and host it. */
  | { kind: "new"; zone: ZoneKey }
  /** "Code invoeren": the overlay asks for a code before connecting. */
  | { kind: "code" }
  /** A mission card was tapped: go straight to that room's lobby. */
  | { kind: "join"; roomCode: string; zone: ZoneKey };
