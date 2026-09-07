/**
 * Request and response shapes for the arena API (spec §9.2).
 *
 * The token response is validated on the way out as well as parsed on the way in: the Ably SDK
 * hands us a token request object, and a shape change there should fail here rather than inside
 * an `authCallback` in the browser where the only symptom is a connection that never opens.
 */

import { z } from "zod";

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
});

/** A signed token request plus who it belongs to. */
export type RealtimeTokenResponse = z.infer<typeof RealtimeTokenResponseSchema>;
