import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "../../prisma/schema.prisma",
  migrations: { path: "../../prisma/migrations" },
  datasource: { url: "postgresql://postgres@127.0.0.1:54329/gta_h3_test" },
});
