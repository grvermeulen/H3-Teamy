import * as Sentry from "@sentry/nextjs";

/** Parseert traces sample rate (0–1) uit server-env; default 0.1. */
function parseTracesSampleRate(): number {
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (raw === undefined || raw === "") return 0.1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0.1;
  return n;
}

Sentry.init({
  dsn: "https://31454117718e26c4a62047b74d633fe0@o4509873010049024.ingest.de.sentry.io/4509873018634320",

  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],

  tracesSampleRate: parseTracesSampleRate(),

  _experiments: {
    enableLogs: true,
  },
});
