import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://31454117718e26c4a62047b74d633fe0@o4509873010049024.ingest.de.sentry.io/4509873018634320",

  _experiments: {
    enableLogs: true,
  },

  tracesSampleRate: 1.0, // Capture 100% of edge transactions for performance monitoring

  beforeSend(event, hint) {
    // Filter out non-critical errors
    if (event.exception) {
      console.error("Sentry Edge Error:", event.exception);
    }
    return event;
  },
});
