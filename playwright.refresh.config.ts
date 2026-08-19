import { defineConfig } from "@playwright/test";

// Refresh-hard-reload suite (docs/superpowers/specs/refresh-hard-reload-design.md).
// No webServer: the spec itself spins `vite preview` per build directory on
// :4320 and swaps them mid-test to simulate deploys. Builds happen in
// refresh-global-setup. Run via `npm run e2e:refresh` (wrapped in
// firebase emulators:exec for the cloud sub-case).
export default defineConfig({
  testDir: "./e2e",
  testMatch: /(^|\/)refresh\.spec\.ts$/,
  globalSetup: "./e2e/refresh-global-setup.ts",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:4320",
    viewport: { width: 390, height: 844 },
    // Fail fast with a located error instead of hanging until the test timeout.
    actionTimeout: 10_000,
  },
});
