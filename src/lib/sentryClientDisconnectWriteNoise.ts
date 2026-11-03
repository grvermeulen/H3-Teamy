import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { isNodeClientDisconnectWriteNoise } from "./nodeClientDisconnectWriteNoise";

/**
 * Bepaalt of een server-side Sentry-event overeenkomt met een `EPIPE`-write
 * na client-disconnect en niet naar ingest gestuurd moet worden.
 *
 * @param _event - Sentry-foutevent.
 * @param hint - Hint met oorspronkelijke exception.
 * @returns `true` wanneer het event genegeerd mag worden.
 */
export function shouldDropNodeClientDisconnectWriteNoiseForSentry(
  _event: ErrorEvent,
  hint: EventHint,
): boolean {
  return isNodeClientDisconnectWriteNoise(hint.originalException);
}
