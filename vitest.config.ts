import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    exclude: [
      ...configDefaults.exclude,
      ".claude/**",
      "convex/tests/applicationReturnFlow.test.ts",
    ],
  },
});
