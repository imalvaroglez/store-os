import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Serves a build directory with `vite preview` on a fixed port and returns an
// idempotent stop(). The refresh e2e swaps dist-a → dist-b (→ dist-cloud) on the
// SAME port to simulate consecutive deploys of one URL.
const PORT = Number(process.env.REFRESH_E2E_PORT || 4320);

export async function servePreview(outDir: string): Promise<() => Promise<void>> {
  const child: ChildProcess = spawn(
    "npx",
    ["vite", "preview", "--outDir", outDir, "--port", String(PORT), "--strictPort"],
    { stdio: "ignore" }
  );
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`vite preview (${outDir}) exited with code ${child.exitCode}`);
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`vite preview (${outDir}) did not come up on :${PORT} within 30s`);
    }
    await delay(250);
  }
  return async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3_000);
      child.once("exit", () => {
        clearTimeout(kill);
        resolve();
      });
    });
    // Give the OS a beat to release the port before the next "deploy" binds it.
    await delay(500);
  };
}
