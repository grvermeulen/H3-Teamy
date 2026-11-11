import type { Event, EventHint } from "@sentry/nextjs";
import {
  isBenignServiceWorkerRegistrationError,
  isBenignServiceWorkerRegistrationMessage,
} from "./benignServiceWorkerRegistrationErrors";

/** Regex voor Sentry `ignoreErrors` — WebKit script load failures voor `/sw.js`. */
export const BENIGN_SERVICE_WORKER_SCRIPT_LOAD_FAILED_IGNORE_RE =
  /Script\s+(?:https?:\/\/\S+)?\/sw\.js\s+load failed/i;

function getEventExceptionMessages(event: Event): string[] {
  const values = event.exception?.values;
  if (!values?.length) {
    return [];
  }
  return values
    .map((entry) => entry?.value)
    .filter((value): value is string => typeof value === "string");
}

/**
 * Filtert client-side Sentry-events van tijdelijke mislukte service-worker loads
 * (JAVASCRIPT-NEXTJS-5N en vergelijkbaar).
 *
 * @param event - Sentry-event (fallback wanneer `hint.originalException` ontbreekt).
 * @param hint - Bevat o.a. `originalException`.
 */
export function shouldDropBenignServiceWorkerNoiseEvent(
  event: Event,
  hint: EventHint,
): boolean {
  const candidates: unknown[] = [
    hint.originalException,
    ...getEventExceptionMessages(event),
    typeof event.message === "string" ? event.message : null,
  ];
  return candidates.some(
    (candidate) =>
      candidate !== null &&
      candidate !== undefined &&
      isBenignServiceWorkerRegistrationError(candidate),
  );
}

/**
 * Sentry-issue-titel voor bulk resolve in CI.
 *
 * @param title - Sentry issue title.
 */
export function isBenignServiceWorkerSentryIssueTitle(title: string): boolean {
  return isBenignServiceWorkerRegistrationMessage(title.trim());
}
