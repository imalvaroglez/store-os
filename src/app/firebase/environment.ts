const vercelEnvironment = import.meta.env.VITE_VERCEL_ENV;

export function shouldUseFirebaseEmulator(
  emulatorFlag: string | undefined,
  deploymentEnvironment: string | undefined
): boolean {
  return emulatorFlag === "true" && !deploymentEnvironment;
}

export const FIREBASE_EMULATOR_REQUESTED = import.meta.env.VITE_FIREBASE_EMULATOR === "true";
export const FIREBASE_EMULATOR_ENABLED = shouldUseFirebaseEmulator(
  import.meta.env.VITE_FIREBASE_EMULATOR,
  vercelEnvironment
);
