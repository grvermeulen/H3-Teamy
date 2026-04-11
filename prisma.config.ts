import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/** Prisma 7 projectconfiguratie: datasource-URL staat hier (niet in `schema.prisma`). */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
