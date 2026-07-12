import { defineConfig } from "@playwright/test";

// E2E against the Firebase Emulator — the FULL suite: smoke + responsive +
// theme + firebase + public-catalog. The app is served by `vite dev` with
// VITE_FIREBASE_EMULATOR=true so Auth + Firestore + Storage route to localhost.
// Under DEV=true the app never forces AuthScreen; each spec logs in via Settings
// -> "Entrar / Crear cuenta" -> signUp, and seedCloudIfEmpty provisions the demo
// stores for the first super_admin.
//
// Each spec file creates ONE browser context in beforeAll and reuses it across
// its tests (Firebase Auth persists to indexedDB, which Playwright's
// storageState does NOT capture), so login + seed run once per file per project
// (seedCloudIfEmpty flakes under repeated wipe+seed cycles).
//
// Start the emulator first: `npm run emulators`. Then: `npm run e2e:firebase`
// (which wraps playwright in firebase emulators:exec to auto-start/teardown).
// mobile + desktop projects so responsive assertions run at both viewports.
export default defineConfig({
  testDir: "./e2e",
  // Anchored names so build-smoke.spec.ts (default-config-only) is NOT matched
  // by the "smoke" alternative — it must not run under the emulator config.
  testMatch: /(^|\/)(firebase|public-catalog|smoke|responsive|theme)\.spec\.ts$/,
  globalSetup: "./e2e/firebase-global-setup.ts",
  timeout: 40_000,
  // Retries: the Firestore emulator's bulk-delete is not instantly durable, so
  // repeated wipe+seed cycles across projects occasionally race the seed. A retry
  // re-runs the failing file's beforeAll (fresh wipe) and almost always clears it.
  // This is emulator-only nondeterminism; production signups are unaffected.
  retries: 2,
  fullyParallel: false,
  // One worker: tests mutate shared emulator state and each file's beforeAll
  // wipes + signs up, so everything must run strictly sequentially.
  workers: 1,
  use: {
    baseURL: "http://localhost:5174",
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
  },
  webServer: {
    command: "VITE_FIREBASE_EMULATOR=true vite --port 5174 --strictPort",
    port: 5174,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    // Mobile: viewport-sensitive specs. Runs first so its wipe+seed cycles hit a
    // fresh emulator (seedCloudIfEmpty flakes after several cycles).
    {
      name: "mobile",
      testMatch: /(^|\/)(smoke|responsive|theme)\.spec\.ts$/,
      use: { viewport: { width: 390, height: 844 } },
    },
    // Desktop: the same viewport-sensitive specs at desktop size.
    {
      name: "desktop",
      testMatch: /(^|\/)(smoke|responsive|theme)\.spec\.ts$/,
      use: { viewport: { width: 1280, height: 800 } },
    },
    // firebase.spec + public-catalog.spec: auth/bootstrap + anonymous catalog.
    // Runs last; self-contained (firebase.spec wipes + provisions in beforeAll,
    // public-catalog REST-seeds its own projection).
    {
      name: "foundation",
      testMatch: /(^|\/)(firebase|public-catalog)\.spec\.ts$/,
    },
  ],
});
