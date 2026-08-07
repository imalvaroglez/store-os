import { defineConfig } from "@playwright/test";

// Fast build smoke + runtime telemetry-egress gate: boots the production
// preview build (DEV=false) and verifies the app boots to the AuthScreen when
// signed out, and that no request hits a forbidden telemetry route/host. The
// full frontend suite (smoke + responsive + theme) runs against the Firebase
// emulator via `npm run e2e:firebase` (see playwright.firebase.config.ts).
export default defineConfig({
  testDir: "./e2e",
  // build-smoke boots the app; telemetry-egress watches runtime egress on the
  // Olivia storefront (no auth/Firestore needed). Both run against the prod build.
  testMatch: /(^|\/)(build-smoke|telemetry-egress)\.spec\.ts$/,
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
