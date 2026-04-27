import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    exclude: [
      "node_modules/**",
      "ecc-reference/**",
      ".next/**",
      "e2e/**",
      "evals/**",
      "**/.opencode/**",
    ],
    alias: {
      "@": resolve(__dirname, "./src"),
    },
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.{ts,tsx}"],
      exclude: [
        "**/*.d.ts",
        "**/*.test.{ts,tsx}",
        "**/__tests__/**",
        "src/lib/kv.ts",
        "src/lib/spaceInvaders/types.ts",
        // Prisma/NextAuth/koppelingslagen — integratie/E2E, niet praktisch voor unit-coverage
        "src/lib/db.ts",
        "src/lib/authOptions.ts",
        "src/lib/activeUser.ts",
        "src/lib/mvp.ts",
      ],
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 55,
        lines: 60,
      },
    },
  },
});
