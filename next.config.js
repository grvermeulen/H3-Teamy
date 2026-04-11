const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
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
    automaticVercelMonitors: true,
  },
});
