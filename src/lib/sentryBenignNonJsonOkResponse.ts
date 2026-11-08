import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { NON_JSON_OK_RESPONSE_SYNTAX_MESSAGE } from "./benignNonJsonOkResponse";
import { isEphemeralVercelPreviewUrl } from "./sentryEphemeralVercelUrl";

function isNonJsonOkResponseSyntaxError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    error.message === NON_JSON_OK_RESPONSE_SYNTAX_MESSAGE
  );
}

function eventImpliesEphemeralPreview(event: ErrorEvent): boolean {
  const env = event.environment?.toLowerCase() ?? "";
  if (env.includes("preview") || env.includes("development")) {
    return true;
  }
  const url = event.request?.url;
  if (typeof url === "string" && isEphemeralVercelPreviewUrl(url)) {
    return true;
  }
  return false;
}

/**
 * Herkent client-side Sentry-events van verwachte niet-JSON 2xx-bodies op preview
 * of infrastructuur-responses die al in {@link fetchJsonOr} worden genegeerd maar
 * nog op oudere bundles binnenkomen (JAVASCRIPT-NEXTJS-5H).
 *
 * @param event - Sentry client error event.
 * @param hint - Hint met de oorspronkelijke exception.
 * @returns `true` wanneer het event niet naar ingest gestuurd moet worden.
 */
export function shouldDropBenignNonJsonOkResponseNoiseForSentry(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  if (!isNonJsonOkResponseSyntaxError(hint.originalException)) {
    return false;
  }
  return eventImpliesEphemeralPreview(event);
}

/**
 * Sentry-issue-titel voor hetzelfde patroon (bulk resolve in CI).
 *
 * @param title - Sentry issue title.
 */
export function isBenignNonJsonOkResponseSentryIssueTitle(
  title: string,
): boolean {
  return title.trim() === `SyntaxError: ${NON_JSON_OK_RESPONSE_SYNTAX_MESSAGE}`;
}
