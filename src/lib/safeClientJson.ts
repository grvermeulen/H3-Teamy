import * as Sentry from "@sentry/nextjs";

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

function isCancelledClientFetch(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  if (isAbortError(error)) {
    return true;
  }
  if (signal?.aborted) {
    return true;
  }
  return false;
}

/**
 * WebKit (Safari, iOS) often throws `TypeError` with message `"Load failed"` for
 * transient network conditions (spotty connectivity, tab suspension) where
 * Chromium would use `"Failed to fetch"`. For optional client calls that already
 * have a safe fallback, reporting these duplicates Sentry noise without
 * indicating an application bug.
 */
function isBenignWebKitLoadFailed(error: unknown): boolean {
  if (error instanceof TypeError && error.message.trim() === "Load failed") {
    return true;
  }
  if (error instanceof Error && error.cause !== undefined) {
    return isBenignWebKitLoadFailed(error.cause);
  }
  return false;
}

/**
 * Chromium/Edge use `TypeError` with message `"Failed to fetch"` for many
 * transient client conditions (offline, tab sleep, connection reset) on the
 * same optional calls where WebKit uses `"Load failed"`. These are not
 * application bugs; we already have fallbacks.
 */
function isBenignChromiumFailedToFetch(error: unknown): boolean {
  if (error instanceof TypeError && error.message.trim() === "Failed to fetch") {
    return true;
  }
  if (error instanceof Error && error.cause !== undefined) {
    return isBenignChromiumFailedToFetch(error.cause);
  }
  return false;
}

/**
 * Performs a browser `fetch`, parses JSON, and never throws: the caller receives
 * `fallback` on failure. Invalid JSON and unexpected errors are reported to
 * Sentry. Aborted requests (`AbortSignal`, React unmount) return `fallback`
 * without reporting — they are expected during navigation. Some browsers
 * surface cancellation as `TypeError: Failed to fetch` while the
 * `AbortSignal` is already aborted; those are treated as cancellation too.
 * WebKit `TypeError: Load failed` and Chromium `TypeError: Failed to fetch` for
 * the same optional fetches are treated as benign transient network conditions
 * and do not create a Sentry event.
 *
 * @param url - Request URL (same as `fetch` first argument).
 * @param init - Optional `fetch` init; pass `undefined` when not needed.
 * @param fallback - Value returned when the request or JSON parse fails.
 * @param context - Short label for Sentry tags (e.g. `event-list-me`).
 * @returns Parsed JSON on success, otherwise `fallback`.
 */
export async function fetchJsonOr<T>(
  url: string,
  init: RequestInit | undefined,
  fallback: T,
  context: string,
): Promise<T> {
  try {
    const res = await fetch(url, init);
    const data = (await res.json()) as T;
    return data;
  } catch (error: unknown) {
    if (
      !isCancelledClientFetch(error, init?.signal ?? undefined) &&
      !isBenignWebKitLoadFailed(error) &&
      !isBenignChromiumFailedToFetch(error)
    ) {
      Sentry.captureException(error, {
        tags: { clientFetch: context },
      });
    }
    return fallback;
  }
}

/**
 * Browser `fetch` plus JSON parse when `response.ok`; returns `null` if the
 * request fails, the response is not OK, or JSON is invalid. Same Sentry and
 * benign fetch-error behaviour as {@link fetchJsonOr}. Use this when the
 * caller distinguishes failure from success via HTTP status (unlike
 * `fetchJsonOr`, which parses even error bodies).
 *
 * @param url - Request URL (same as `fetch` first argument).
 * @param init - Optional `fetch` init; pass `undefined` when not needed.
 * @param context - Short label for Sentry tags (e.g. `event-list-rsvp-counts`).
 * @returns Parsed JSON when status is 2xx, otherwise `null`.
 */
export async function fetchJsonIfOkOr<T>(
  url: string,
  init: RequestInit | undefined,
  context: string,
): Promise<T | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as T;
  } catch (error: unknown) {
    if (
      !isCancelledClientFetch(error, init?.signal ?? undefined) &&
      !isBenignWebKitLoadFailed(error) &&
      !isBenignChromiumFailedToFetch(error)
    ) {
      Sentry.captureException(error, {
        tags: { clientFetch: context },
      });
    }
    return null;
  }
}
