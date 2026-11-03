import * as Sentry from "@sentry/nextjs";
import type { CaptureContext } from "@sentry/core";
import { isBenignTransientClientFetchError } from "./benignClientFetchErrors";

/**
 * Rapporteert een browser-side exception naar Sentry, behalve bij bekende tijdelijke
 * fetch/netwerkfouten (Chromium/WebKit/Firefox) die geen applicatiebug zijn.
 *
 * @param error - Gevangen fout of rejection.
 * @param captureContext - Optionele Sentry-tags/extra (zelfde vorm als `captureException`).
 */
export function captureBrowserException(
  error: unknown,
  captureContext?: CaptureContext,
): void {
  if (isBenignTransientClientFetchError(error)) {
    return;
  }
  Sentry.captureException(error, captureContext);
}
