import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl =
  process.env.DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

/** Prisma 7 projectconfiguratie: datasource-URL staat hier (niet in `schema.prisma`). */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // `prisma generate` draait in CI zonder echte DB; fallback is alleen voor client-generatie.
    url: databaseUrl,
  },
});
