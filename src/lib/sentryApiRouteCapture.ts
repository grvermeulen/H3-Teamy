import { isDbUnavailableError } from "./dbUnavailableError";
import { isTransientPrismaConnectSentryNoise } from "./sentryTransientPrismaConnectNoise";

/**
 * Bepaalt of een API-route `Sentry.captureException` moet aanroepen.
 * Verwachte DB-connectieblips en 503-paden worden afgehandeld zonder Sentry-issue.
 *
 * @param error - Fout uit het route-`catch`-blok.
 * @returns `true` wanneer de melding naar Sentry mag (onverwachte bug).
 */
export function shouldCaptureApiRouteException(error: unknown): boolean {
  if (isDbUnavailableError(error)) return false;
  if (isTransientPrismaConnectSentryNoise(error)) return false;
  return true;
}
