import * as Sentry from "@sentry/nextjs";

/**
 * Next.js instrumentation hook: laadt runtime-specifieke Sentry-configuratie
 * (Node vs Edge) op basis van `NEXT_RUNTIME`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
