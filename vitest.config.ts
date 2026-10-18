import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "."), "server-only": path.resolve(import.meta.dirname, "node_modules/next/dist/compiled/server-only/empty.js") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: true,
  },
});
