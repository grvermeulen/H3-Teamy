import type { ErrorEvent, EventHint } from "@sentry/core";

/** Turbopack overlay / console when root `package.json` is not valid JSON during dev HMR. */
const TURBOPACK_ROOT_PACKAGE_JSON_LOC_RE = /\.\/package\.json:\d+:\d+/;

/** Turbopack compile location for a source file, e.g. `./src/lib/dbMetrics.ts:1:1`. */
const TURBOPACK_SRC_FILE_LOC_RE = /\.\/src\/[^\s:]+:\d+:\d+/;

/**
 * Bepaalt of een foutmelding Turbopack-ruis is uit lokale dev/HMR (tijdelijk ongeldige bron
 * of parse-fouten), geen productiebug.
 *
 * @param message - Gecombineerde exception- / eventtekst.
 * @returns `true` wanneer dit verwachte dev-compile-ruis is.
 */
export function isBenignTurbopackDevCompileNoise(message: string): boolean {
  if (
    TURBOPACK_ROOT_PACKAGE_JSON_LOC_RE.test(message) ||
    TURBOPACK_SRC_FILE_LOC_RE.test(message)
  ) {
    return true;
  }
  const lower = message.toLowerCase();
  return (
    lower.includes("error parsing package.json file") &&
    lower.includes("package.json is not parseable")
  );
}

function eventMessage(event: ErrorEvent, hint: EventHint): string {
  const original = hint.originalException;
  const fromException =
    original instanceof Error ? original.message : String(original ?? "");
  const fromEvent = String(event.exception?.values?.[0]?.value ?? "");
  const title = String(event.message ?? "");
  return `${fromException}\n${fromEvent}\n${title}`;
}

function isLocalDevRequest(event: ErrorEvent): boolean {
  const envTag = String(event.tags?.environment ?? event.environment ?? "");
  if (envTag === "development") return true;
  const reqUrl = String(
    (event.request as { url?: string } | undefined)?.url ??
      event.tags?.url ??
      "",
  );
  return reqUrl.includes("localhost") || reqUrl.includes("127.0.0.1");
}

/**
 * Filtert Sentry-events van Turbopack compile-/parsefouten tijdens lokale ontwikkeling.
 * Productie-builds falen al bij echte compile-fouten; deze meldingen komen via
 * `consoleLoggingIntegration` van de dev-overlay (ook wanneer de DSN naar productie wijst).
 *
 * @param event - Sentry-foutevent.
 * @param hint - Hint met oorspronkelijke exception.
 * @returns `true` wanneer het event niet naar ingest gestuurd moet worden.
 */
export function shouldDropBenignTurbopackDevCompileNoiseForSentry(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  if (!isBenignTurbopackDevCompileNoise(eventMessage(event, hint))) {
    return false;
  }
  if (process.env.NODE_ENV === "production" && !isLocalDevRequest(event)) {
    return false;
  }
  return true;
}
