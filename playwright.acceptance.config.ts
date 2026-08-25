import { defineConfig } from "@playwright/test";
// Manual-acceptance config: REAL dev backend (no emulator), vite dev server.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /manual-acceptance\.spec\.ts$/,
  timeout: 600_000,
  workers: 1,
  use: { baseURL: "http://localhost:5173", viewport: { width: 1280, height: 800 }, actionTimeout: 20_000 },
  webServer: { command: "npm run dev -- --port 5173 --strictPort", port: 5173, reuseExistingServer: true, timeout: 60_000 },
});
