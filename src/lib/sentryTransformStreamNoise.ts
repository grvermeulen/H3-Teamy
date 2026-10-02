import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { isNodeTransformStreamRaceNoise } from "./nodeTransformStreamNoise";

/**
 * Bepaalt of een server-side Sentry-event overeenkomt met de bekende Node.js
 * `TransformStream`-race tijdens RSC-streaming en niet naar ingest gestuurd
 * moet worden.
 *
 * @param _event - Sentry-foutevent.
 * @param hint - Hint met oorspronkelijke exception.
 * @returns `true` wanneer het event genegeerd mag worden.
 */
export function shouldDropNodeTransformStreamNoiseForSentry(
  _event: ErrorEvent,
  hint: EventHint,
): boolean {
  return isNodeTransformStreamRaceNoise(hint.originalException);
}
