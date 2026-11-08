import { defineConfig } from "@playwright/test";

// Build first with the emulator-only .env configuration; never reuse a server
// connected to a remote Firebase project. All fixtures stay on 127.0.0.1.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/firebase-global-setup.ts",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: { baseURL: "http://localhost:4323", actionTimeout: 10_000 },
  webServer: { command: "npm run preview -- --port 4323 --strictPort", port: 4323, reuseExistingServer: false },
  projects: [
    { name: "mobile", testMatch: /(purchase-ticket-flow|responsive)\.spec\.ts$/, use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop", testMatch: /(purchase-ticket-flow|responsive)\.spec\.ts$/, use: { viewport: { width: 1440, height: 900 } } },
    { name: "regression", testMatch: /purchase-ux2\.spec\.ts$/, use: { viewport: { width: 1280, height: 800 } } },
  ],
});
