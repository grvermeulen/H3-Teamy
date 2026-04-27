import type { Event, EventHint } from "@sentry/nextjs";

/**
 * Herkent veelvoorkomende ongebruikte promise rejections van browserextensies
 * (Chrome: `runtime.sendMessage` zonder geldige tab). Die komen niet uit onze app
 * maar worden wel als `unhandledrejection` gerapporteerd.
 *
 * @param _event - Sentry-event (niet gebruikt; handtekening gelijk aan `beforeSend`).
 * @param hint - Bevat o.a. `originalException`.
 * @returns `true` als dit event genegeerd mag worden (niet naar Sentry sturen).
 */
export function shouldDropBrowserExtensionNoiseEvent(
  _event: Event,
  hint: EventHint,
): boolean {
  const message = getOriginalExceptionMessage(hint.originalException);
  if (!message) return false;
  return isChromeExtensionRuntimeSendMessageTabNotFound(message);
}

function getOriginalExceptionMessage(original: unknown): string | null {
  if (original instanceof Error && typeof original.message === "string") {
    return original.message;
  }
  if (typeof original === "string") return original;
  return null;
}

function isChromeExtensionRuntimeSendMessageTabNotFound(
  message: string,
): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("runtime.sendmessage") && lower.includes("tab not found")
  );
}
