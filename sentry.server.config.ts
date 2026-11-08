import * as Sentry from "@sentry/nextjs";
import {
  shouldDropBenignClientFetchNoiseEvent,
  shouldDropBenignClientFetchNoiseLog,
} from "@/lib/sentryBenignClientFetchNoise";
import { shouldDropBenignTurbopackDevCompileNoiseForSentry } from "@/lib/sentryBenignTurbopackDevCompileNoise";
import { shouldDropDevLocalhostDbNoiseForSentry } from "@/lib/sentryDevDbNoise";
import { shouldDropInvalidMultipartBodyNoiseForSentry } from "@/lib/sentryInvalidMultipartBodyNoise";
import { shouldDropDbUnavailableErrorForSentry } from "@/lib/sentryDbUnavailableNoise";
import { shouldDropTransientPrismaConnectNoiseForSentry } from "@/lib/sentryTransientPrismaConnectNoise";
import { shouldDropNodeClientDisconnectWriteNoiseForSentry } from "@/lib/sentryClientDisconnectWriteNoise";
import { shouldDropNodeTransformStreamNoiseForSentry } from "@/lib/sentryTransformStreamNoise";
import { shouldDropPgPoolNoiseForSentry } from "@/lib/sentryPgPoolNoise";
import { shouldDropRedisNoiseForSentry } from "@/lib/sentryRedisNoise";
import { shouldDropReportExtractProviderNoiseForSentry } from "@/lib/sentryReportExtractProviderNoise";
import { shouldDropWaapiNotificationNoiseForSentry } from "@/lib/waapiNotificationSentry";

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
    if (shouldDropBenignClientFetchNoiseEvent(event, hint)) return null;
    if (shouldDropDbUnavailableErrorForSentry(event, hint)) return null;
    if (shouldDropTransientPrismaConnectNoiseForSentry(event, hint)) {
      return null;
    }
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
    if (shouldDropReportExtractProviderNoiseForSentry(event, hint)) {
      return null;
    }
    if (shouldDropWaapiNotificationNoiseForSentry(event, hint)) {
      return null;
    }
    return event;
  },

  beforeSendLog(log) {
    if (shouldDropBenignClientFetchNoiseLog(log)) {
      return null;
    }
    return log;
  },

  _experiments: {
    enableLogs: true,
  },
});
