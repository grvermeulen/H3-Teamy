import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent, EventHint } from "@sentry/core";

/** Parseert traces sample rate (0–1) uit server-env; default 0.1. */
function parseTracesSampleRate(): number {
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (raw === undefined || raw === "") return 0.1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0.1;
  return n;
}

function shouldDropDevLocalhostDbNoise(
  event: ErrorEvent,
  hint: EventHint,
): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const envTag = String(event.tags?.environment ?? "");
  if (envTag !== "development") return false;
  const reqUrl = String(
    (event.request as { url?: string } | undefined)?.url ??
      event.tags?.url ??
      "",
  );
  if (!reqUrl.includes("localhost") && !reqUrl.includes("127.0.0.1"))
    return false;
  const original = hint.originalException;
  const msg =
    (original instanceof Error ? original.message : "") +
    String(event.exception?.values?.[0]?.value ?? "");
  const lower = msg.toLowerCase();
  return (
    lower.includes("can't reach database server") ||
    lower.includes("p1001") ||
    lower.includes("127.0.0.1:5432")
  );
}

Sentry.init({
  dsn: "https://31454117718e26c4a62047b74d633fe0@o4509873010049024.ingest.de.sentry.io/4509873018634320",

  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],

  tracesSampleRate: parseTracesSampleRate(),

  beforeSend(event, hint) {
    if (shouldDropDevLocalhostDbNoise(event, hint)) return null;
    return event;
  },

  _experiments: {
    enableLogs: true,
  },
});
