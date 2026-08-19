import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Serves a build directory with `vite preview` on a fixed port and returns an
// idempotent stop(). The refresh e2e swaps dist-a → dist-b (→ dist-cloud) on the
// SAME port to simulate consecutive deploys of one URL.
const PORT = Number(process.env.REFRESH_E2E_PORT || 4320);

export async function servePreview(outDir: string, expectMarker?: string): Promise<() => Promise<void>> {
  // Spawn vite directly (node), NOT via npx: SIGTERM to an npx/npm wrapper does
  // not reach the vite child, which keeps the port bound — the next "deploy"
  // then dies on --strictPort while the readiness probe happily hits the OLD
  // server and the test never actually crosses a deploy (bit us in CI).
  const child: ChildProcess = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "preview", "--outDir", outDir, "--port", String(PORT), "--strictPort"],
    { stdio: "ignore" }
  );
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`vite preview (${outDir}) exited with code ${child.exitCode}`);
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) {
        // Guard the deploy rotation itself: the served HTML must carry THIS
        // build's marker, or we're talking to a stale server on the port.
        if (expectMarker) {
          const html = await res.text();
          if (!html.includes(`content="${expectMarker}"`)) {
            throw new Error(`Port :${PORT} is serving a build without marker ${expectMarker} — stale server from a previous turn`);
          }
        }
        break;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("stale server")) throw error;
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
