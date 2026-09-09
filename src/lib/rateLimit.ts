/**
 * Request rate limits for the arena routes.
 *
 * A fixed window per subject — the signed-in user where there is one, the client address where
 * the route is public — counted on Redis through {@link kvIncrementWindow}. The window is keyed
 * by its own index, so a key expires on its own and a limiter never has to reset anything.
 *
 * It fails open: when no store answers, the request goes through and the failure is already in
 * Sentry. A game among friends should lose its rate limit before it loses its game.
 */

import { NextResponse, type NextRequest } from "next/server";
import { kvIncrementWindow } from "./kv";

/** One limit: at most `limit` requests per `windowSec` seconds, per subject. */
export type RateLimitRule = {
  /** Names the counter key; one per route. */
  name: string;
  limit: number;
  windowSec: number;
};

/** What the arena routes allow, per minute. */
export const ARENA_LIMITS = {
  /** One token per connection with an hour's TTL; a reconnect storm is a few a minute. */
  token: { name: "arena-token", limit: 20, windowSec: 60 },
  /** A potje lasts three minutes and the write is idempotent besides. */
  matches: { name: "arena-matches", limit: 6, windowSec: 60 },
  /** The launcher polls every ten seconds; room for tab-switching on top. */
  rooms: { name: "arena-rooms", limit: 30, windowSec: 60 },
  /** Read-only and cached for half a minute. */
  leaderboard: { name: "arena-leaderboard", limit: 30, windowSec: 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Whether a request may proceed, and if not, when to try again. */
export type RateLimitVerdict =
  { allowed: true } | { allowed: false; retryAfterSec: number };

/** The Dutch line a limited request gets back (spec §16's register). */
export const RATE_LIMITED_MESSAGE = "Even rustig aan, probeer het zo opnieuw.";

/** Milliseconds in a second. */
const MS_PER_SECOND = 1000;

/**
 * Counts one request against a rule and says whether it may proceed.
 *
 * @param rule - The limit.
 * @param subject - Who is being counted: a user id, or a client address.
 * @param now - The clock, injectable so tests need no fake timers.
 * @returns Allowed, or refused with the seconds left in the window.
 */
export async function checkRateLimit(
  rule: RateLimitRule,
  subject: string,
  now: () => number = () => Date.now(),
): Promise<RateLimitVerdict> {
  const windowMs = rule.windowSec * MS_PER_SECOND;
  const at = now();
  const windowIndex = Math.floor(at / windowMs);
  const count = await kvIncrementWindow(
    `ratelimit:${rule.name}:${subject}:${windowIndex}`,
    rule.windowSec,
  );
  if (count === null || count <= rule.limit) return { allowed: true };
  const windowEnd = (windowIndex + 1) * windowMs;
  return {
    allowed: false,
    retryAfterSec: Math.max(1, Math.ceil((windowEnd - at) / MS_PER_SECOND)),
  };
}

/**
 * The 429 for a refused request, with `Retry-After` so a well-behaved client waits it out.
 *
 * @param verdict - The refusal.
 * @returns The response.
 */
export function rateLimited(verdict: { retryAfterSec: number }): NextResponse {
  return NextResponse.json(
    { error: RATE_LIMITED_MESSAGE },
    {
      status: 429,
      headers: { "Retry-After": String(verdict.retryAfterSec) },
    },
  );
}

/**
 * The address a public route counts against: the first hop of `x-forwarded-for`, which is the
 * client as Vercel's edge saw it, and a fixed label when there is none (a test, a local run).
 *
 * @param req - The request.
 * @returns The subject for a rate limit.
 */
export function clientAddress(req: Pick<NextRequest, "headers">): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}
