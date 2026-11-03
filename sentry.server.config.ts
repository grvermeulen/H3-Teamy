import * as Sentry from "@sentry/nextjs";
import { shouldDropBenignTurbopackDevCompileNoiseForSentry } from "@/lib/sentryBenignTurbopackDevCompileNoise";
import { shouldDropDevLocalhostDbNoiseForSentry } from "@/lib/sentryDevDbNoise";
import { shouldDropInvalidMultipartBodyNoiseForSentry } from "@/lib/sentryInvalidMultipartBodyNoise";
import { shouldDropNodeClientDisconnectWriteNoiseForSentry } from "@/lib/sentryClientDisconnectWriteNoise";
import { shouldDropNodeTransformStreamNoiseForSentry } from "@/lib/sentryTransformStreamNoise";
import { shouldDropPgPoolNoiseForSentry } from "@/lib/sentryPgPoolNoise";
import { shouldDropDbUnavailableErrorForSentry } from "@/lib/dbUnavailableSentryNoise";
import { shouldDropRedisNoiseForSentry } from "@/lib/sentryRedisNoise";

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

  beforeSend(event, hint) {
    if (shouldDropDbUnavailableErrorForSentry(event, hint)) return null;
    if (shouldDropDevLocalhostDbNoiseForSentry(event, hint)) return null;
    if (shouldDropInvalidMultipartBodyNoiseForSentry(event, hint)) return null;
    if (shouldDropPgPoolNoiseForSentry(event, hint)) return null;
    if (shouldDropRedisNoiseForSentry(event, hint)) return null;
    if (shouldDropNodeTransformStreamNoiseForSentry(event, hint)) return null;
    if (shouldDropNodeClientDisconnectWriteNoiseForSentry(event, hint)) {
      return null;
    }
    if (shouldDropBenignTurbopackDevCompileNoiseForSentry(event, hint)) {
      return null;
    }
    return event;
  },

  _experiments: {
    enableLogs: true,
  },
});
