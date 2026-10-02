import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// This suite exclusively targets the disposable loopback database, never a dotenv URL.
const databaseUrl = "postgresql://postgres@127.0.0.1:54329/gta_h3_test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/arena/*.integration.test.ts"],
    fileParallelism: false,
    alias: { "@": resolve(__dirname, "src") },
    env: {
      DATABASE_URL: databaseUrl,
      PRISMA_DATABASE_URL: databaseUrl,
      PREVIEW_DATABASE_URL: databaseUrl,
      VERCEL_ENV: "development",
      REDIS_URL: "",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      NEXT_PUBLIC_SENTRY_DSN: "",
      SENTRY_DSN: "",
    },
  },
});
