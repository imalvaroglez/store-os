import { type FullConfig } from "@playwright/test";
import { wipeEmulator } from "./helpers";

// Wipe Auth + Firestore in the emulator before the run, so the "first signup
// becomes super_admin" bootstrap is deterministic. No-op if the emulator isn't
// reachable (e.g. CI without emulator).
//
// Storage is intentionally NOT wiped: the Storage emulator exposes no bulk-reset
// endpoint (unlike Auth/Firestore), and `npm run e2e:firebase` wraps the run in
// `firebase emulators:exec`, which spins up a fresh emulator instance every run,
// so Storage starts empty deterministically without an explicit wipe.
export default async function globalSetup(_config: FullConfig) {
  await wipeEmulator();
}
