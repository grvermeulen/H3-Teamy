import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { DbUnavailableError, isDbUnavailableError } from "./dbUnavailableError";

const DB_UNAVAILABLE_MESSAGE = "Database tijdelijk niet beschikbaar";

/**
 * Bepaalt of een fout overeenkomt met een verwachte DB-onbeschikbaarheid (503),
 * die routes afhandelen zonder Sentry-issue.
 *
 * @param error - Fout uit `catch`, `onRequestError` of Sentry-hint.
 * @returns `true` wanneer de melding operationele DB-downtime is, geen bug.
 */
export function isDbUnavailableSentryNoise(error: unknown): boolean {
  if (isDbUnavailableError(error)) return true;
  if (error instanceof Error && error.name === "DbUnavailableError") {
    return true;
  }
  if (error instanceof Error && error.message === DB_UNAVAILABLE_MESSAGE) {
    return true;
  }
  return false;
}

/**
 * Bepaalt of een server-side Sentry-event een {@link DbUnavailableError} is
 * en niet naar ingest gestuurd moet worden (JAVASCRIPT-NEXTJS-53/54).
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
  return (
    event.exception?.values?.some(
      (v) =>
        v.type === "DbUnavailableError" ||
        v.value === DB_UNAVAILABLE_MESSAGE,
    ) ?? false
  );
}
