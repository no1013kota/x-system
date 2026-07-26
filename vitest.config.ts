import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // REQUIRE_DB=1 のときだけローカルSupabaseの到達性を先に検証する（skipの静かな緑を防ぐ）。
    globalSetup: ["./vitest.global-setup.ts"],
  },
});
