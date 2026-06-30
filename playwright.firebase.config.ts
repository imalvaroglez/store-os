import { defineConfig } from "@playwright/test";

// E2E against the Firebase Emulator. The app is served by `vite dev` with
// VITE_FIREBASE_EMULATOR=true so it routes Auth + Firestore + Storage to
// localhost (Storage via connectStorageEmulator in src/app/firebase/storage.ts).
// Start the emulator first: `npm run emulators`. Then: `npm run e2e:firebase`
// (which wraps playwright in firebase emulators:exec to auto-start/teardown).
export default defineConfig({
  testDir: "./e2e",
  testMatch: /(firebase|public-catalog)\.spec\.ts/,
  globalSetup: "./e2e/firebase-global-setup.ts",
  timeout: 40_000,
  fullyParallel: false,
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
});
