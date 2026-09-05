import type { Event, EventHint } from "@sentry/nextjs";

/** Regex voor Sentry `ignoreErrors` — zelfde patroon als {@link isBrowserExtensionRuntimeSendMessageNoise}. */
export const BROWSER_EXTENSION_RUNTIME_SEND_MESSAGE_IGNORE_RE =
  /runtime\.sendMessage.*tab not found/i;

/**
 * Herkent browserextensie-ruis op basis van een foutmelding.
 *
 * @param message - Tekst van rejection/exception.
 * @returns `true` bij bekende `runtime.sendMessage`-tabfouten van extensies.
 */
export function isBrowserExtensionRuntimeSendMessageNoise(
  message: string,
): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("runtime.sendmessage") && lower.includes("tab not found")
  );
}

/**
 * Herkent veelvoorkomende ongebruikte promise rejections van browserextensies
 * (Chrome/Safari-extensies: `runtime.sendMessage` zonder geldige tab). Die komen
 * niet uit onze app maar worden wel als `unhandledrejection` gerapporteerd.
 *
 * @param event - Sentry-event (fallback wanneer `hint.originalException` ontbreekt).
 * @param hint - Bevat o.a. `originalException`.
 * @returns `true` als dit event genegeerd mag worden (niet naar Sentry sturen).
 */
export function shouldDropBrowserExtensionNoiseEvent(
  event: Event,
  hint: EventHint,
): boolean {
  const candidates = [
    getOriginalExceptionMessage(hint.originalException),
    getEventExceptionMessage(event),
    typeof event.message === "string" ? event.message : null,
  ];
  return candidates.some(
    (message) => message !== null && isBrowserExtensionRuntimeSendMessageNoise(message),
  );
}

function getOriginalExceptionMessage(original: unknown): string | null {
  if (original instanceof Error && typeof original.message === "string") {
    return original.message;
  }
  if (typeof original === "string") return original;
  if (
    typeof original === "object" &&
    original !== null &&
    "message" in original &&
    typeof (original as { message: unknown }).message === "string"
  ) {
    return (original as { message: string }).message;
  }
  return null;
}

function getEventExceptionMessage(event: Event): string | null {
  const value = event.exception?.values?.[0]?.value;
  return typeof value === "string" ? value : null;
}
