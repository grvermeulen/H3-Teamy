import "./sentry.client.config";
import * as Sentry from "@sentry/nextjs";

/** Vereist door @sentry/nextjs voor navigatie-tracing (App Router). */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
