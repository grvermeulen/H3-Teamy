import * as Sentry from "@sentry/nextjs";

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
export const onRequestError = Sentry.captureRequestError;
