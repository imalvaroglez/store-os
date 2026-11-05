// Unit + CLI tests for scripts/check-release.cjs (#179). The CLI runs in CI's
// production deploy path, so it is exercised here exactly as invoked: spawned
// node against fixture trees, plus a live probe against a local http server.
import { describe, it, expect, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:http";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "..", "..", "scripts", "check-release.cjs");
// The script's CJS exports (pure logic, testable without spawning).
const logic = require(SCRIPT) as {
  parseSemver: (v: unknown) => number[] | null;
  compareSemver: (a: unknown, b: unknown) => number | null;
  extractServedVersion: (html: string) => string | null;
};

function fixture(overrides?: { packageVersion?: string; releases?: Array<Record<string, unknown>> }) {
  const root = mkdtempSync(join(tmpdir(), "check-release-"));
  mkdirSync(join(root, "src", "releases"), { recursive: true });
  const releases: Array<Record<string, unknown>> =
    overrides?.releases ??
    [{ version: "1.5.0", date: "2026.11.06", title: "Prueba", notes: ["Una nota"] }];
  writeFileSync(join(root, "src", "releases", "releases.json"), JSON.stringify(releases, null, 2));
  const firstVersion = typeof releases[0]?.version === "string" ? releases[0].version : "1.5.0";
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture", version: overrides?.packageVersion ?? firstVersion }, null, 2)
  );
  return root;
}

async function run(root: string, args: string[] = []) {
  // execFile (async), NOT spawnSync: a sync spawn blocks this process's event
  // loop, so the local probe server could never answer the child — deadlock.
  // Also strip proxy vars: an HTTP_PROXY would route the loopback fetch away.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(https?_proxy|all_proxy|HTTPS?_PROXY|ALL_PROXY)$/i.test(key)) delete env[key];
  }
  let settle: (value: { code: number | null; out: string }) => void = () => {};
  const done = new Promise<{ code: number | null; out: string }>((resolve) => {
    settle = resolve;
  });
  execFile(
    process.execPath,
    [SCRIPT, "--root", root, ...args],
    { encoding: "utf8", timeout: 15000, env, killSignal: "SIGKILL" },
    (error, stdout, stderr) => settle({ code: error ? ((error.code as number) ?? 1) : 0, out: `${stdout}${stderr}` })
  );
  return done;
}

describe("check-release lógica", () => {
  it("semver estricto y comparación", async () => {
    expect(logic.parseSemver("1.2.3")).toEqual([1, 2, 3]);
    expect(logic.parseSemver("1.2")).toBeNull();
    expect(logic.parseSemver("v1.2.3")).toBeNull();
    expect(logic.compareSemver("1.5.0", "1.4.9")).toBeGreaterThan(0);
    expect(logic.compareSemver("1.5.0", "1.5.0")).toBe(0);
    expect(logic.compareSemver("2.0.0", "10.0.0")).toBeLessThan(0);
  });

  it("extrae la versión servida del meta de producción", async () => {
    expect(logic.extractServedVersion('<head><meta name="store-os-version" content="1.4.2">')).toBe("1.4.2");
    expect(logic.extractServedVersion("<head><meta name=\"x-build\" content=\"abc\">")).toBeNull();
  });
});

describe("check-release CLI", () => {
  const roots: string[] = [];
  const clean = (root: string) => roots.push(root);

  it("aprueba un árbol válido", async () => {
    const root = fixture(); clean(root);
    const r = await run(root);
    expect(r.code).toBe(0);
    expect(r.out).toContain("1.5.0");
  });

  it("rechaza package.json y notas divergentes", async () => {
    const root = fixture({ packageVersion: "1.4.0" }); clean(root);
    const r = await run(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("divergen");
  });

  it("rechaza versión sin notas y fecha inválida", async () => {
    const root = fixture({
      releases: [{ version: "1.6.0", date: "2026-11-06", title: "X", notes: [] }],
    }); clean(root);
    const r = await run(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("nota");
    expect(r.out).toContain("fecha");
  });

  it("rechaza liberar una versión que producción ya sirve o supera", async () => {
    const root = fixture({ releases: [{ version: "1.5.0", date: "2026.11.06", title: "X", notes: ["n"] }] }); clean(root);
    const r = await run(root, ["--probe-url", "http://127.0.0.1:0/no-reachable"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("No se pudo verificar");
  });

  it("aprueba (con aviso) una producción sin meta — transición de #179", async () => {
    const serve = await startServer('<html><head><meta name="x-build" content="abc"></head></html>');
    try {
      const root = fixture(); clean(root);
      const r = await run(root, ["--probe-url", serve.url]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("⚠");
    } finally {
      serve.close();
    }
  });

  it("detecta versión no incrementada contra la producción viva", async () => {
    const serve = await startServer('<html><head><meta name="store-os-version" content="1.5.0"></head></html>');
    try {
      const root = fixture(); clean(root); // candidate 1.5.0 vs served 1.5.0
      const r = await run(root, ["--probe-url", serve.url]);
      expect(r.code).toBe(1);
      expect(r.out).toContain("ya sirve 1.5.0");

      const bumped = fixture({
        releases: [
          { version: "1.6.0", date: "2026.11.07", title: "Nueva", notes: ["n"] },
          { version: "1.5.0", date: "2026.11.06", title: "X", notes: ["n"] },
        ],
      }); clean(bumped);
      expect((await run(bumped, ["--probe-url", serve.url])).code).toBe(0);
    } finally {
      serve.close();
    }
  });

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });
});

function startServer(html: string): Promise<{ url: string; close: () => void }> {
  return new Promise((resolveP) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveP({
        url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`,
        close: () => server.close(),
      });
    });
  });
}

