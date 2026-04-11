import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://31454117718e26c4a62047b74d633fe0@o4509873010049024.ingest.de.sentry.io/4509873018634320",

  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],

  tracesSampleRate: 1.0,

  _experiments: {
    enableLogs: true,
  },
});
