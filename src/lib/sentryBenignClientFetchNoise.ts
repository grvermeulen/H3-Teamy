import type { Event, EventHint } from "@sentry/nextjs";
import { isBenignTransientClientFetchError } from "./benignClientFetchErrors";

/** Regex voor Sentry `ignoreErrors` — zelfde patroon als {@link isBenignTransientClientFetchError}. */
export const BENIGN_TRANSIENT_CLIENT_FETCH_IGNORE_RE =
  /^(TypeError:\s*)?(Load failed|Failed to fetch|NetworkError when attempting to fetch resource\.|A network error occurred\.)(\s+\([^)]+\))?$/i;

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

function getEventExceptionMessage(event: Event): string | null {
  const value = event.exception?.values?.[0]?.value;
  return typeof value === "string" ? value : null;
}

function shouldDropCandidate(candidate: unknown): boolean {
  if (candidate === null || candidate === undefined) {
    return false;
  }
  return (
    isBenignTransientClientFetchError(candidate) || isAbortError(candidate)
  );
}

/**
 * Filtert client-side Sentry-events van bekende tijdelijke fetch/netwerkfouten
 * (Chromium, WebKit, Firefox) die geen applicatiebug aangeven.
 *
 * @param event - Sentry-event (fallback wanneer `hint.originalException` ontbreekt).
 * @param hint - Bevat o.a. `originalException`.
 * @returns `true` als dit event genegeerd mag worden (niet naar Sentry sturen).
 */
export function shouldDropBenignClientFetchNoiseEvent(
  event: Event,
  hint: EventHint,
): boolean {
  const candidates: unknown[] = [
    hint.originalException,
    getEventExceptionMessage(event),
    typeof event.message === "string" ? event.message : null,
  ];
  return candidates.some(shouldDropCandidate);
}

/**
 * Herkent Sentry-issue-titels die alleen tijdelijke client-side fetch-ruis groeperen
 * (zelfde vorm als {@link shouldDropBenignClientFetchNoiseEvent}, bv. JAVASCRIPT-NEXTJS-57).
 *
 * @param title - Sentry issue title (often `TypeError: Failed to fetch (host)`).
 */
export function isBenignTransientClientFetchSentryIssueTitle(
  title: string,
): boolean {
  return isBenignTransientClientFetchError(title.trim());
}
