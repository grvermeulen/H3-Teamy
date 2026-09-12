import * as Sentry from "@sentry/nextjs";
import {
  BROWSER_EXTENSION_RUNTIME_SEND_MESSAGE_IGNORE_RE,
  shouldDropBrowserExtensionNoiseEvent,
} from "@/lib/sentryBrowserExtensionNoise";
import { shouldDropBenignClientFetchNoiseEvent } from "@/lib/sentryBenignClientFetchNoise";

/**
 * Parseert traces sample rate (0–1) uit env; default 0.1 voor productie.
 * `NEXT_PUBLIC_*` is nodig omdat deze config in de browserbundle landt.
 */
function parseTracesSampleRate(): number {
  const raw = process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
  if (raw === undefined || raw === "") return 0.1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return 0.1;
  return n;
}

Sentry.init({
  dsn: "https://31454117718e26c4a62047b74d633fe0@o4509873010049024.ingest.de.sentry.io/4509873018634320",

  ignoreErrors: [BROWSER_EXTENSION_RUNTIME_SEND_MESSAGE_IGNORE_RE],

  beforeSend(event, hint) {
    if (shouldDropBrowserExtensionNoiseEvent(event, hint)) {
      return null;
    }
    if (shouldDropBenignClientFetchNoiseEvent(event, hint)) {
      return null;
    }
    return event;
  },

  integrations: [
    Sentry.replayIntegration(),
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],

  tracesSampleRate: parseTracesSampleRate(),
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  _experiments: {
    enableLogs: true,
  },
});
