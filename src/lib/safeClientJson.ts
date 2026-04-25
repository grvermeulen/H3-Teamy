import * as Sentry from "@sentry/nextjs";

/**
 * Performs a browser `fetch`, parses JSON, and never throws: network failures
 * (e.g. WebKit `TypeError: Load failed`) and invalid JSON are reported to
 * Sentry and the caller receives `fallback` instead.
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
    Sentry.captureException(error, {
      tags: { clientFetch: context },
    });
    return fallback;
  }
}
