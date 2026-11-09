import {
  isBenignTransientClientFetchError,
  isBenignTransientClientFetchMessage,
  normalizeBenignClientFetchMessage,
} from "./benignClientFetchErrors";

/** WebKit/Safari when `/sw.js` fails to download (offline, tab discard, transient CDN). */
const SW_SCRIPT_LOAD_FAILED_RE =
  /^Script\s+(?:https?:\/\/\S+)?\/sw\.js\s+load failed$/i;

/**
 * Herkent meldingen van mislukte service-worker-registratie door netwerk of browserlimiet,
 * geen applicatiebug (de app werkt zonder worker).
 *
 * @param message - Ruwe fouttekst (event value, Error.message, enz.).
 */
export function isBenignServiceWorkerRegistrationMessage(
  message: string,
): boolean {
  const msg = normalizeBenignClientFetchMessage(message);
  if (SW_SCRIPT_LOAD_FAILED_RE.test(msg)) {
    return true;
  }
  if (isBenignTransientClientFetchMessage(msg)) {
    return true;
  }
  if (
    /Failed to register a ServiceWorker/i.test(msg) &&
    /\/sw\.js/i.test(msg) &&
    (/network error occurred/i.test(msg) ||
      /load failed/i.test(msg) ||
      /Failed to fetch/i.test(msg))
  ) {
    return true;
  }
  return false;
}

/**
 * Herkent exceptions van mislukte PWA worker-registratie die niet naar Sentry hoeven.
 *
 * @param error - Gevangen rejection of Error uit `navigator.serviceWorker.register`.
 */
export function isBenignServiceWorkerRegistrationError(
  error: unknown,
): boolean {
  if (isBenignTransientClientFetchError(error)) {
    return true;
  }

  if (typeof error === "string") {
    return isBenignServiceWorkerRegistrationMessage(error);
  }

  if (error instanceof TypeError || error instanceof DOMException) {
    return isBenignServiceWorkerRegistrationMessage(error.message);
  }

  if (error instanceof Error) {
    if (isBenignServiceWorkerRegistrationMessage(error.message)) {
      return true;
    }
    if (error.cause !== undefined) {
      return isBenignServiceWorkerRegistrationError(error.cause);
    }
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return isBenignServiceWorkerRegistrationMessage(
      (error as { message: string }).message,
    );
  }

  return false;
}
