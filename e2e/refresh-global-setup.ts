import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import type { FullConfig } from "@playwright/test";

// Builds for the refresh suite. A and B are plain production builds whose ONLY
// difference is the injected build marker (STORE_OS_BUILD_SHA) — two consecutive
// "deploys" of the same URL. The cloud build targets the emulator, which
// production-mode builds hard-disable (src/app/firebase/config.ts), so it uses
// --mode emulator. ponytail: the emulator build skips SW registration
// (import.meta.env.DEV is true in non-production modes); that's fine — the
// cloud case tests subscription + session rehydration, not the SW.
function build(outDir: string, args: string[], env: NodeJS.ProcessEnv) {
  rmSync(outDir, { recursive: true, force: true });
  execSync(`npx vite build --outDir ${outDir} ${args.join(" ")}`, {
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

export default async function globalSetup(_config: FullConfig) {
  build("dist-a", [], { STORE_OS_BUILD_SHA: "refresh-a" });
  build("dist-b", [], { STORE_OS_BUILD_SHA: "refresh-b" });
  build("dist-cloud", ["--mode", "emulator"], {
    STORE_OS_BUILD_SHA: "refresh-c",
    VITE_FIREBASE_EMULATOR: "true",
  });
}
