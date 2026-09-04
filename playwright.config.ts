import { defineConfig } from "@playwright/test";

// Fast build smoke + runtime telemetry-egress gate. Backend integration runs
// separately with `npm run e2e:dev` against the real store-os-dev project.
export default defineConfig({
  testDir: "./e2e",
  // build-smoke boots the app; telemetry-egress watches runtime egress on the
  // Olivia storefront (no auth/Firestore needed). Both run against the prod build.
  testMatch: /(^|\/)(build-smoke|telemetry-egress)\.spec\.ts$/,
  testIgnore: /(^|\/)(dev-backend)\.spec\.ts$/,
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
