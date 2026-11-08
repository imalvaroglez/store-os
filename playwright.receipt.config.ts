import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /(^|\/)receipt-print\.spec\.ts$/,
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4320",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "vite --port 4320 --strictPort",
    port: 4320,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
