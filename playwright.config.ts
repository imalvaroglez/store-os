import { defineConfig } from "@playwright/test";

// Fast build smoke: boots the production preview build (DEV=false) and verifies
// the app boots to the AuthScreen when signed out. The full frontend suite
// (smoke + responsive + theme) now runs against the Firebase emulator via
// `npm run e2e:firebase` (see playwright.firebase.config.ts).
export default defineConfig({
  testDir: "./e2e",
  testMatch: /build-smoke\.spec\.ts/,
  // The emulator-only specs are excluded; they run via playwright.firebase.config.ts.
  testIgnore: /(^|\/)(firebase|public-catalog|smoke|responsive|theme)\.spec\.ts$/,
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
