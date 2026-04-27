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
 * Performs a browser `fetch`, parses JSON, and never throws: network failures
 * (e.g. `TypeError: Failed to fetch`, WebKit `TypeError: Load failed`) and
 * invalid JSON are reported to Sentry and the caller receives `fallback`
 * instead. Aborted requests (`AbortSignal`, React unmount) return `fallback`
 * without reporting — they are expected during navigation. Some browsers
 * surface cancellation as `TypeError: Failed to fetch` while the
 * `AbortSignal` is already aborted; those are treated as cancellation too.
 * WebKit `TypeError: Load failed` for the same optional fetches is treated as
 * a benign network condition and does not create a Sentry event.
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
      !isBenignWebKitLoadFailed(error)
    ) {
      Sentry.captureException(error, {
        tags: { clientFetch: context },
      });
    }
    return fallback;
  }
}
