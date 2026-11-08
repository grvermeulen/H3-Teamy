import * as Sentry from "@sentry/nextjs";
import { isBenignTransientClientFetchError } from "./benignClientFetchErrors";
import {
  isBenignNonJsonOkResponseBody,
  isBenignNonJsonOkResponseContentType,
  NON_JSON_OK_RESPONSE_SYNTAX_MESSAGE,
} from "./benignNonJsonOkResponse";

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
 * Browsers use different messages for transient fetch failures on unreliable
 * networks (offline, tab suspension, connection reset). Optional client helpers
 * already return a safe fallback; reporting every occurrence duplicates Sentry
 * noise without indicating an application bug.
 */
function isBenignTransientFetchTypeError(error: unknown): boolean {
  return isBenignTransientClientFetchError(error);
}

type ResponseJsonDetails =
  { ok: true; value: unknown } | { ok: false; bodyText: string };

async function readResponseJsonDetails(
  response: Response,
): Promise<ResponseJsonDetails> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false, bodyText: "" };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, bodyText: text };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, bodyText: text };
  }
}

function shouldSkipSentryForInvalidJsonOkResponse(
  response: Response,
  bodyText: string,
): boolean {
  return (
    isBenignNonJsonOkResponseBody(bodyText) ||
    isBenignNonJsonOkResponseContentType(response.headers.get("content-type"))
  );
}

function reportInvalidJsonOkResponse(
  url: string,
  response: Response,
  bodyText: string,
  context: string,
): void {
  Sentry.captureException(
    new SyntaxError(NON_JSON_OK_RESPONSE_SYNTAX_MESSAGE),
    {
      tags: { clientFetch: context },
      extra: {
        url,
        status: response.status,
        contentType: response.headers.get("content-type"),
        bodyPrefix: bodyText.slice(0, 160),
      },
    },
  );
}

/**
 * Parses JSON from a `fetch` response body. Returns `null` when the body is empty
 * or not valid JSON (for example Vercel edge `Error 429:` plain-text rate limits).
 *
 * @param response - A resolved `fetch` response whose body has not been read yet.
 * @returns Parsed value, or `null` when parsing fails.
 */
export async function readResponseJson(
  response: Response,
): Promise<unknown | null> {
  const details = await readResponseJsonDetails(response);
  return details.ok ? details.value : null;
}

/**
 * Performs a browser `fetch`, parses JSON, and never throws: unexpected failures
 * (network errors other than known benign transient `TypeError`s, invalid JSON on
 * success responses) are reported to Sentry and the caller receives `fallback`
 * instead. Non-OK HTTP statuses return `fallback` without parsing the body (edge
 * rate limits often respond with plain text such as `Error 429:`). Aborted
 * requests (`AbortSignal`, React unmount) return `fallback` without reporting —
 * they are expected during navigation. Some browsers surface cancellation as
 * `TypeError: Failed to fetch` while the `AbortSignal` is already aborted; those
 * are treated as cancellation too. Chromium `TypeError: Failed to fetch` and
 * WebKit `TypeError: Load failed` from transient connectivity are treated as
 * benign and do not create a Sentry event. HTML or empty 2xx bodies (preview/WAF)
 * return `fallback` without Sentry.
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
    if (!res.ok) {
      return fallback;
    }
    const details = await readResponseJsonDetails(res);
    if (!details.ok) {
      if (!shouldSkipSentryForInvalidJsonOkResponse(res, details.bodyText)) {
        reportInvalidJsonOkResponse(url, res, details.bodyText, context);
      }
      return fallback;
    }
    return details.value as T;
  } catch (error: unknown) {
    if (
      !isCancelledClientFetch(error, init?.signal ?? undefined) &&
      !isBenignTransientFetchTypeError(error)
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
 * Chromium/WebKit transient fetch `TypeError` behaviour as {@link fetchJsonOr}.
 * Use this when the
 * caller distinguishes failure from success via HTTP status. Non-OK responses
 * return `null` without parsing the body.
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
    const details = await readResponseJsonDetails(res);
    if (!details.ok) {
      if (!shouldSkipSentryForInvalidJsonOkResponse(res, details.bodyText)) {
        reportInvalidJsonOkResponse(url, res, details.bodyText, context);
      }
      return null;
    }
    return details.value as T;
  } catch (error: unknown) {
    if (
      !isCancelledClientFetch(error, init?.signal ?? undefined) &&
      !isBenignTransientFetchTypeError(error)
    ) {
      Sentry.captureException(error, {
        tags: { clientFetch: context },
      });
    }
    return null;
  }
}
