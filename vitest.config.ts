import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

/**
 * Tests run on the same source the app is built from.
 *
 * The alias mirrors tsconfig.web.json, so a test imports `@shared/types` the
 * way the renderer does and a change to either side that breaks the other fails
 * here rather than at runtime.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
  // The renderer is built by Vite with the automatic runtime; the tests import
  // components directly, so they need the same transform rather than the
  // classic one they would get by default.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    // The stubs Chromium gives and jsdom does not. The files that need a
    // browser say so with a `@vitest-environment jsdom` line; this runs for
    // every test and does nothing where there is no window.
    setupFiles: ["./src/renderer/src/test/setup.ts"],
  },
})
