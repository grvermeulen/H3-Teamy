const { withSentryConfig } = require("@sentry/nextjs");
const pkg = require("./package.json");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  /** CommonJS `ical` + `rrule` load more reliably when not bundled by Turbopack (Vercel preview). */
  serverExternalPackages: ["ical"],
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  /** Map tiles are content-versioned by path (`/arena/map/v1/...`), so they can be cached forever. */
  async headers() {
    return [
      {
        source: "/arena/map/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

module.exports = withSentryConfig(nextConfig, {
  org: "h3-teamy",
  /** Moet exact de project slug in Sentry zijn (Project → Settings → General). */
  project: process.env.SENTRY_PROJECT || "javascript-nextjs",

  silent: !process.env.CI,
  widenClientFileUpload: true,
  /** Vereist voor release + source maps upload tijdens build; zet in Vercel (Production/Preview). */
  authToken: process.env.SENTRY_AUTH_TOKEN,

  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
    /** Cron check-ins only on production; preview deploys are ephemeral (Sentry uptime noise). */
    automaticVercelMonitors: process.env.VERCEL_ENV === "production",
  },
});
