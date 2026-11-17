import { connectFunctionsEmulator, getFunctions, type Functions } from "firebase/functions";
import { FIREBASE_EMULATOR_ENABLED, getFirebase } from "./config";

// Shared callable transport: ONE Functions instance per app, region-locked
// (us-east1, never a project id), connected to the local emulator exactly
// once. Every callable client (PDF import, trusted credit ops) goes through
// this so duplicate connects can't race.
let fns: Functions | null = null;
let fnsConnected = false;

export function functionsInstance(): Functions {
  const { app } = getFirebase();
  if (!fns) fns = getFunctions(app, "us-east1");
  if (FIREBASE_EMULATOR_ENABLED && !fnsConnected) {
    const host = import.meta.env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
    const [hostname, port] = host.split(":");
    connectFunctionsEmulator(fns, hostname, Number(port));
    fnsConnected = true;
  }
  return fns;
}
