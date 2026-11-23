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
    // DOM tests opt into jsdom via per-file `@vitest-environment jsdom`
    // comments (environmentMatchGlobs was removed in vitest 4).
    setupFiles: ["src/test-setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/usage-report.test.mjs"],
  },
});
