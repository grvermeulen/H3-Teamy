const fs = require("node:fs");
const dotenv = require("dotenv");
const root = require("node:path").resolve(__dirname, "../..");
process.chdir(root);
const configured = {};
let arenaAblyKey = "";
for (const name of [
  ".env",
  ".env.development",
  ".env.local",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
]) {
  if (fs.existsSync(name)) {
    const values = dotenv.parse(fs.readFileSync(name));
    Object.assign(configured, values);
    if (!name.includes("production") && values.ABLY_API_KEY)
      arenaAblyKey = values.ABLY_API_KEY;
  }
}
// Define every dotenv key before Next loads it, isolating all integrations except arena realtime.
for (const key of Object.keys(configured)) process.env[key] = "";
const local = "postgresql://postgres@127.0.0.1:54329/gta_h3_test";
for (const prefix of ["", "PREVIEW_"])
  for (const key of [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "DIRECT_URL",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
    "POSTGRES_PRISMA_URL",
    "PRISMA_DATABASE_URL",
  ])
    process.env[prefix + key] = local;
process.env.ABLY_API_KEY = arenaAblyKey;
process.env.NEXTAUTH_SECRET = "isolated-gta-h3-test-session-secret-2026-09-12";
process.env.NEXTAUTH_URL = "http://localhost:3100";
process.env.APP_URL = "http://localhost:3100";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3100";
process.env.NEXT_TELEMETRY_DISABLED = "1";
process.env.VERCEL_ENV = "development";
process.env.ENABLE_EMAIL = "false";
const mode = process.argv[2] || "dev";
if (mode === "presence")
  console.log(
    JSON.stringify({
      ablyConfigured: !!process.env.ABLY_API_KEY,
      database: "isolated loopback",
    }),
  );
else {
  process.argv = [
    process.execPath,
    "next",
    mode,
    ...(mode === "build" ? [] : ["-p", "3100", "-H", "127.0.0.1"]),
  ];
  require("next/dist/bin/next");
}
