import type { Event, EventHint } from "@sentry/nextjs";
import { isBenignTransientClientFetchError } from "./benignClientFetchErrors";

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  if (error instanceof Error && error.cause !== undefined) {
    return isAbortError(error.cause);
  }
  return false;
}

/**
 * Filtert client-side Sentry-events van bekende tijdelijke fetch/netwerkfouten
 * (Chromium, WebKit, Firefox) die geen applicatiebug aangeven.
 *
 * @param _event - Sentry-event (niet gebruikt; handtekening gelijk aan `beforeSend`).
 * @param hint - Bevat o.a. `originalException`.
 * @returns `true` als dit event genegeerd mag worden (niet naar Sentry sturen).
 */
export function shouldDropBenignClientFetchNoiseEvent(
  _event: Event,
  hint: EventHint,
): boolean {
  const original = hint.originalException;
  return isBenignTransientClientFetchError(original) || isAbortError(original);
}
