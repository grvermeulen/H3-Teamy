import * as Sentry from "@sentry/nextjs";
import { isDbUnavailableSentryNoise } from "./lib/dbUnavailableSentryNoise";
import { isNodeClientDisconnectWriteNoise } from "./lib/nodeClientDisconnectWriteNoise";

/**
 * Next.js instrumentation hook: laadt runtime-specifieke Sentry-configuratie
 * (Node vs Edge) op basis van `NEXT_RUNTIME`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/ensureNextAuthUrl");
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/**
 * Next.js `onRequestError`-hook: stuurt requestfouten door naar Sentry.
 * @see {@link https://docs.sentry.io/platforms/javascript/guides/nextjs/ | Sentry Next.js}
 */
const captureRequestError = Sentry.captureRequestError;

/** Slaat bekende client-disconnect `EPIPE`-writes over; stuurt overige requestfouten naar Sentry. */
export const onRequestError: typeof captureRequestError = (
  ...args: Parameters<typeof captureRequestError>
) => {
  if (isNodeClientDisconnectWriteNoise(args[0])) {
    return;
  }
  if (isDbUnavailableSentryNoise(args[0])) {
    return;
  }
  return captureRequestError(...args);
};
