import type { Event, EventHint, Log } from "@sentry/nextjs";
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

function getEventExceptionMessages(event: Event): string[] {
  const values = event.exception?.values;
  if (!values?.length) {
    return [];
  }
  return values
    .map((entry) => entry?.value)
    .filter((value): value is string => typeof value === "string");
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
    ...getEventExceptionMessages(event),
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

function logMessageText(log: Log): string | null {
  const raw = log.message;
  if (raw === undefined || raw === null) {
    return null;
  }
  return String(raw);
}

/**
 * Filtert Sentry Logs (o.a. `consoleLoggingIntegration`) van tijdelijke client fetch-ruis.
 *
 * @param log - Sentry log record vóór verzending.
 * @returns `true` wanneer dit log niet naar Sentry gestuurd mag worden.
 */
export function shouldDropBenignClientFetchNoiseLog(log: Log): boolean {
  const message = logMessageText(log);
  if (message !== null && isBenignTransientClientFetchError(message)) {
    return true;
  }
  const attrs = log.attributes;
  if (attrs && typeof attrs === "object") {
    for (const value of Object.values(attrs)) {
      if (
        typeof value === "string" &&
        isBenignTransientClientFetchError(value)
      ) {
        return true;
      }
    }
  }
  return false;
}
