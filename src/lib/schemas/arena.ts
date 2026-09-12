/**
 * Request and response shapes for the arena API (spec §9.2).
 *
 * The token response is validated on the way out as well as parsed on the way in: the Ably SDK
 * hands us a token request object, and a shape change there should fail here rather than inside
 * an `authCallback` in the browser where the only symptom is a connection that never opens.
 */

import { z } from "zod";
import { ArenaRoomTicketSchema } from "../cityArena/net/roomProtocol";

/** What Ably's `createTokenRequest` returns, as much of it as the client needs. */
export const AblyTokenRequestSchema = z.object({
  keyName: z.string(),
  clientId: z.string().optional(),
  ttl: z.number().optional(),
  timestamp: z.number(),
  capability: z.string(),
  nonce: z.string(),
  mac: z.string(),
});

/** The body of a successful `GET /api/arena/realtime-token`. */
export const RealtimeTokenResponseSchema = z.object({
  tokenRequest: AblyTokenRequestSchema,
  clientId: z.string(),
  displayName: z.string(),
  ticket: ArenaRoomTicketSchema,
});

/** A signed token request plus who it belongs to. */
export type RealtimeTokenResponse = z.infer<typeof RealtimeTokenResponseSchema>;

/** One player's line as the host posts it. */
const MatchResultSchema = z
  .object({
    memberId: z.uuid(),
    kills: z.number().int().min(0).max(200),
    deaths: z.number().int().min(0).max(200),
    won: z.boolean(),
  })
  .strict();

/**
 * A finished potje as the host posts it.
 *
 * Identity, timestamps and the eligible roster come from the server-owned round.
 */
export const PostMatchSchema = z
  .object({
    roundId: z.uuid(),
    memberId: z.uuid(),
    epoch: z.number().int().positive(),
    results: z.array(MatchResultSchema).min(1).max(8),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.results.map((row) => row.memberId)).size ===
      value.results.length,
    { message: "Een speler mag maar één uitslag hebben" },
  );

/** A posted potje. */
export type PostMatchBody = z.infer<typeof PostMatchSchema>;
