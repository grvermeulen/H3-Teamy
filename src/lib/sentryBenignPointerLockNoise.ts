import type { Event, EventHint } from "@sentry/nextjs";
import { isBenignPointerLockClientError } from "./benignPointerLockErrors";

/** Regex voor Sentry `ignoreErrors` — zelfde patroon als {@link isBenignPointerLockClientError}. */
export const BENIGN_POINTER_LOCK_WRONG_DOCUMENT_IGNORE_RE =
  /not valid for pointer lock/i;

/**
 * Filtert client-side Sentry-events van pointer-lock-afwijzingen buiten onze app
 * (WrongDocumentError wanneer een extensie of embedded context lock probeert).
 *
 * @param event - Sentry-event (fallback wanneer `hint.originalException` ontbreekt).
 * @param hint - Bevat o.a. `originalException`.
 * @returns `true` als dit event genegeerd mag worden (niet naar Sentry sturen).
 */
export function shouldDropBenignPointerLockNoiseEvent(
  event: Event,
  hint: EventHint,
): boolean {
  const candidates = [
    hint.originalException,
    getEventExceptionMessage(event),
    typeof event.message === "string" ? event.message : null,
  ];
  return candidates.some(
    (candidate) =>
      candidate !== null && isBenignPointerLockClientError(candidate),
  );
}

function getEventExceptionMessage(event: Event): string | null {
  const value = event.exception?.values?.[0]?.value;
  return typeof value === "string" ? value : null;
}
