import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { isInvalidMultipartBodyError } from "./multipartFormData";

/**
 * Bepaalt of een server-side Sentry-event overeenkomt met een verwachte
 * clientfout bij ongeldige multipart-bodies (bots, lege POSTs) en genegeerd
 * mag worden.
 *
 * @param _event - Sentry-foutevent.
 * @param hint - Hint met oorspronkelijke exception.
 * @returns `true` wanneer het event niet naar ingest gestuurd moet worden.
 */
export function shouldDropInvalidMultipartBodyNoiseForSentry(
  _event: ErrorEvent,
  hint: EventHint,
): boolean {
  return isInvalidMultipartBodyError(hint.originalException);
}
