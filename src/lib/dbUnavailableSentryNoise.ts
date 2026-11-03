import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { DbUnavailableError, isDbUnavailableError } from "./dbUnavailableError";

/**
 * Herkent {@link DbUnavailableError} en Sentry-geserialiseerde varianten
 * (naam/bericht) zodat verwachte 503-paden geen issues vormen.
 *
 * @param error - Fout uit `catch`, `onRequestError` of `hint.originalException`.
 * @returns `true` wanneer de melding overeenkomt met database tijdelijk niet beschikbaar.
 */
export function isDbUnavailableSentryNoise(error: unknown): boolean {
  if (isDbUnavailableError(error)) return true;
  if (!(error instanceof Error)) return false;
  if (error.name === DbUnavailableError.name) return true;
  return error.message === "Database tijdelijk niet beschikbaar";
}

/**
 * Bepaalt of een server-side Sentry-event een verwachte {@link DbUnavailableError} is
 * en niet naar ingest gestuurd moet worden.
 *
 * @param event - Sentry-foutevent.
 * @param hint - Hint met oorspronkelijke exception.
 * @returns `true` wanneer het event genegeerd mag worden.
 */
export function shouldDropDbUnavailableErrorForSentry(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  if (isDbUnavailableSentryNoise(hint.originalException)) return true;

  const values = event.exception?.values;
  if (!values?.length) return false;
  for (const value of values) {
    if (value.type === DbUnavailableError.name) return true;
    if (value.value === "Database tijdelijk niet beschikbaar") return true;
  }
  return false;
}
