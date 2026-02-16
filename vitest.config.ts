import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [], // Add setup file if we need to extend matchers later
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
