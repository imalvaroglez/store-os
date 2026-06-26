import { defineConfig } from "@playwright/test";

// Real end-to-end: boots the production preview server and drives the actual app
// with clicks/keyboard at a mobile viewport. Run via `npm run e2e`.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4319",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: "npm run preview -- --port 4319 --strictPort",
    port: 4319,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
