import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // #252 (6th occurrence, sharper signature): CI runners can exceed the 5s
    // default on hydration-dependent tests — the global asyncUtilTimeout from
    // test-setup covers the waits, but the TEST itself also needs headroom.
    // Passing tests finish at their own speed; only failures report slower.
    testTimeout: 20000,
    environment: "node",
    // DOM tests opt into jsdom via per-file environment comments.
    environmentMatchGlobs: [
      ["src/app/App.test.tsx", "jsdom"],
      ["src/design-system/primitives.test.tsx", "jsdom"],
      ["src/design-system/theme/theme.test.tsx", "jsdom"],
      ["src/features/catalog/CatalogScreen.test.tsx", "jsdom"],
      ["src/features/home/HomeScreen.test.tsx", "jsdom"],
      ["src/lib/cart.test.ts", "jsdom"],
      ["src/features/catalog/OliviaStorefront.test.tsx", "jsdom"],
      ["src/features/stores/StorePickerScreen.test.tsx", "jsdom"],
    ],
    setupFiles: ["src/test-setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/usage-report.test.mjs"],
  },
});
