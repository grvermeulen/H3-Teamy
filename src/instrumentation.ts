import * as Sentry from "@sentry/nextjs";
import { isDbUnavailableSentryNoise } from "./lib/sentryDbUnavailableNoise";
import { isNodeClientDisconnectWriteNoise } from "./lib/nodeClientDisconnectWriteNoise";
import { isTransientPrismaConnectSentryNoise } from "./lib/sentryTransientPrismaConnectNoise";

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

/** Slaat verwachte DB-503, transient Prisma-connectie- en client-disconnect `EPIPE`-writes over. */
export const onRequestError: typeof captureRequestError = (
  ...args: Parameters<typeof captureRequestError>
) => {
  if (isDbUnavailableSentryNoise(args[0])) {
    return;
  }
  if (isTransientPrismaConnectSentryNoise(args[0])) {
    return;
  }
  if (isNodeClientDisconnectWriteNoise(args[0])) {
    return;
  }
  return captureRequestError(...args);
};
