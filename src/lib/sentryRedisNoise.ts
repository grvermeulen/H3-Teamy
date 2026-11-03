import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { isRedisTransientConnectionNoise } from "./redisConnectionError";

/**
 * Bepaalt of een server-side Sentry-event overeenkomt met bekende ioredis-
 * transient-connection-ruis en niet naar ingest gestuurd moet worden.
 *
 * @param _event - Sentry-foutevent.
 * @param hint - Hint met oorspronkelijke exception.
 * @returns `true` wanneer het event genegeerd mag worden.
 */
export function shouldDropRedisNoiseForSentry(
  _event: ErrorEvent,
  hint: EventHint,
): boolean {
  return isRedisTransientConnectionNoise(hint.originalException);
}
