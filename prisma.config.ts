import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Datasource-URL voor Prisma CLI (`migrate deploy`, `generate`).
 * Directe URL eerst (migraties); daarna Vercel Postgres-integratie; `PRISMA_DATABASE_URL` als laatste
 * (vaak pooler — sommige hosts accepteren migraties daar niet).
 */
const databaseUrl =
  process.env.PREVIEW_DATABASE_URL_UNPOOLED ??
  process.env.PREVIEW_POSTGRES_URL_NON_POOLING ??
  process.env.PREVIEW_DATABASE_URL ??
  process.env.PREVIEW_POSTGRES_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_PRISMA_URL ??
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
