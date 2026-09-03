import { defineConfig } from "@playwright/test";

// Integration browser suite against the real Firebase development project.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /(^|\/)dev-backend\.spec\.ts$/,
  globalSetup: "./e2e/dev-global-setup.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:5174",
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
  },
  webServer: {
    command: "npm run dev -- --port 5174 --strictPort",
    port: 5174,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
