import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // DOM tests opt into jsdom via per-file environment comments.
    environmentMatchGlobs: [
      ["src/app/App.test.tsx", "jsdom"],
      ["src/design-system/primitives.test.tsx", "jsdom"],
      ["src/design-system/theme/theme.test.tsx", "jsdom"],
    ],
    setupFiles: ["src/test-setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
