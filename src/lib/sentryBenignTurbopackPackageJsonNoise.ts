import type { ErrorEvent, EventHint } from "@sentry/core";

/** Turbopack compile overlay / console when root `package.json` is not valid JSON during dev HMR. */
const TURBOPACK_ROOT_PACKAGE_JSON_LOC_RE = /\.\/package\.json:\d+:\d+/;

/**
 * Bepaalt of een foutmelding Turbopack-ruis is rond het parsen van de root `package.json`
 * (typisch tijdelijk ongeldige JSON tijdens lokale bewerkingen of merge-conflicts in dev).
 *
 * @param message - Gecombineerde exception- / eventtekst.
 * @returns `true` wanneer dit geen productiebug is.
 */
export function isBenignTurbopackRootPackageJsonParseNoise(
  message: string,
): boolean {
  if (TURBOPACK_ROOT_PACKAGE_JSON_LOC_RE.test(message)) {
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
 * Filtert Sentry-events van Turbopack `package.json`-parsefouten tijdens lokale ontwikkeling.
 * Productie-deploys falen al bij een ongeldige `package.json`; deze meldingen zijn dev/HMR-ruis.
 *
 * @param event - Sentry-foutevent.
 * @param hint - Hint met oorspronkelijke exception.
 * @returns `true` wanneer het event niet naar ingest gestuurd moet worden.
 */
export function shouldDropBenignTurbopackPackageJsonNoiseForSentry(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  if (!isBenignTurbopackRootPackageJsonParseNoise(eventMessage(event, hint))) {
    return false;
  }
  if (process.env.NODE_ENV === "production" && !isLocalDevRequest(event)) {
    return false;
  }
  return true;
}
