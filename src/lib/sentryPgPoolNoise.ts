import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { isPgPoolIdleDisconnectNoise } from "./pgPoolError";

/**
 * Bepaalt of een server-side Sentry-event overeenkomt met bekende `pg.Pool` /
 * Prisma-Postgres-pooler-ruis (idle disconnect, connect-timeout, afgebroken
 * SCRAM-handshake) en niet naar ingest gestuurd moet worden.
 *
 * @param _event - Sentry-foutevent.
 * @param hint - Hint met oorspronkelijke exception.
 * @returns `true` wanneer het event genegeerd mag worden.
 */
export function shouldDropPgPoolNoiseForSentry(
  _event: ErrorEvent,
  hint: EventHint,
): boolean {
  return isPgPoolIdleDisconnectNoise(hint.originalException);
}
