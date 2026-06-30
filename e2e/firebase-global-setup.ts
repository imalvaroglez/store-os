import { type FullConfig } from "@playwright/test";

// Wipe Auth + Firestore in the emulator before the run, so the "first signup
// becomes super_admin" bootstrap is deterministic. No-op if the emulator isn't
// reachable (e.g. CI without emulator). Uses the emulator's project namespace
// "store-os-demo" that the app targets.
//
// Storage is intentionally NOT wiped: the Storage emulator exposes no bulk-reset
// endpoint (unlike Auth/Firestore), and `npm run e2e:firebase` wraps the run in
// `firebase emulators:exec`, which spins up a fresh emulator instance every run —
// so Storage starts empty deterministically without an explicit wipe.
const PROJECT = "store-os-demo";

async function wipe() {
  try {
    // Auth: clear all accounts via the emulator admin API.
    await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, {
      method: "DELETE",
    });
    // Firestore: clear all documents for the project.
    await fetch(
      `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
      { method: "DELETE" }
    );
  } catch {
    // Emulator not reachable — skip (tests will fail loudly if needed).
  }
}

export default async function globalSetup(_config: FullConfig) {
  await wipe();
}
