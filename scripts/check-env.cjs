#!/usr/bin/env node
/**
 * Build-time guard against cross-environment Firebase misconfiguration.
 *
 * ponytail: this is DEFENSE-IN-DEPTH, not primary security. The real isolation
 * between dev (store-os-dev) and production (store-os-f7cf8) comes from each
 * Vercel target pointing at a DIFFERENT Firebase project via scoped env vars,
 * plus Firestore Security Rules. A determined actor with prod's public config
 * can still instantiate the SDK and write — that's by Firebase design (access
 * is enforced by rules, not by hiding keys). This check only catches the
 * common accident: a Preview deployment that inherited prod's env vars and
 * would silently write to Olivia's real data.
 *
 * Rules:
 *   VITE_VERCEL_ENV === 'preview'     + projectId === PROD  => FAIL (preview must not touch prod)
 *   VITE_VERCEL_ENV === 'production'  + projectId !== PROD  => FAIL (prod must point at prod)
 *   (no VITE_VERCEL_ENV, i.e. local dev)                   => PASS (warns)
 *
 * VITE_VERCEL_ENV is injected automatically by Vercel per deployment target.
 */
"use strict";

const PROD_PROJECT_ID = "store-os-f7cf8";

function fail(msg) {
  console.error(`\x1b[31m[check-env] BLOQUEADO:\x1b[0m ${msg}`);
  console.error(
    "[check-env] Revisa las Environment Variables en Vercel (Settings → Environment Variables)."
  );
  console.error(
    "[check-env] Production → store-os-f7cf8. Preview → store-os-dev. Ninguna con scope 'All Environments'."
  );
  process.exit(1);
}

function pass(msg) {
  console.log(`\x1b[32m[check-env] OK:\x1b[0m ${msg}`);
}

/**
 * @param {string|null|undefined} vercelEnv
 * @param {string|null|undefined} projectId
 */
function check(vercelEnv, projectId) {
  // Local builds (no VITE_VERCEL_ENV): no guard, but log what we'd target.
  if (!vercelEnv) {
    const note = projectId
      ? `build local sin VITE_VERCEL_ENV; projectId detectado = ${projectId}`
      : "build local sin VITE_VERCEL_ENV ni projectId (modo demo/emulador)";
    console.log(`[check-env] ${note}`);
    return;
  }

  if (vercelEnv === "preview") {
    // Preview MUST point at the dev project: anything else is a misconfiguration.
    // The empty/undefined case is the spec's dominant-risk scenario (a Vercel env
    // var missing or mis-scoped), so we block it rather than pass silently.
    if (!projectId || projectId === PROD_PROJECT_ID) {
      fail(
        `deploy de Preview con projectId '${projectId}' (vacío o producción). ` +
          "Preview debe apuntar a store-os-dev con VITE_FIREBASE_PROJECT_ID definido."
      );
    }
    pass(`Preview → projectId ${projectId} (correcto: no es prod).`);
    return;
  }

  if (vercelEnv === "production") {
    if (projectId !== PROD_PROJECT_ID) {
      fail(
        `deploy de Production apunta a projectId '${projectId}', no a producción (${PROD_PROJECT_ID}).`
      );
    }
    pass(`Production → projectId ${projectId} (correcto).`);
    return;
  }

  // Any other VITE_VERCEL_ENV value (e.g. 'development'): permissive.
  console.log(`[check-env] VITE_VERCEL_ENV='${vercelEnv}'; sin regla de bloqueo.`);
}

// --- Entry point ---
if (require.main === module) {
  if (process.argv.includes("--test")) {
    runSelfTest();
  } else {
    check(process.env.VITE_VERCEL_ENV, process.env.VITE_FIREBASE_PROJECT_ID);
  }
}

// --- Self-test: `node scripts/check-env.cjs --test` runs assertions. ---
// ponytail: no test framework for scripts/; embed the smallest runnable check
// instead of adding CommonJS test infra. Fails the process if any case is wrong.
function runSelfTest() {
  const assert = require("assert");
  let exitCode = 0;

  /** @param {string} name @param {()=>void} fn */
  const it = (name, fn) => {
    try {
      fn();
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (e) {
      console.error(`  \x1b[31m✗\x1b[0m ${name}: ${e.message}`);
      exitCode = 1;
    }
  };

  // check() never returns on FAIL (it calls process.exit(1)). We stub it to
  // throw so the assertion can catch the "would-block" case.
  const origExit = process.exit;
  let blocked = false;
  process.exit = (code) => {
    blocked = code !== 0;
    throw new Error("__BLOCKED__");
  };

  it("preview + prod projectId => blocked", () => {
    blocked = false;
    try {
      check("preview", PROD_PROJECT_ID);
    } catch (e) {
      /* expected */
    }
    assert.ok(blocked, "debería bloquear");
  });

  it("preview + dev projectId => not blocked", () => {
    blocked = false;
    try {
      check("preview", "store-os-dev");
    } catch (e) {
      /* expected */
    }
    assert.ok(!blocked, "NO debería bloquear");
  });

  it("preview + empty projectId => blocked (dominant-risk case)", () => {
    blocked = false;
    try {
      check("preview", "");
    } catch (e) {
      /* expected */
    }
    assert.ok(blocked, "projectId vacío en preview debe bloquear");
    blocked = false;
    try {
      check("preview", undefined);
    } catch (e) {
      /* expected */
    }
    assert.ok(blocked, "projectId undefined en preview debe bloquear");
  });

  it("production + dev projectId => blocked", () => {
    blocked = false;
    try {
      check("production", "store-os-dev");
    } catch (e) {
      /* expected */
    }
    assert.ok(blocked, "debería bloquear");
  });

  it("production + prod projectId => not blocked", () => {
    blocked = false;
    try {
      check("production", PROD_PROJECT_ID);
    } catch (e) {
      /* expected */
    }
    assert.ok(!blocked, "NO debería bloquear");
  });

  it("no vercelEnv (local) => not blocked", () => {
    blocked = false;
    try {
      check(undefined, PROD_PROJECT_ID);
    } catch (e) {
      /* expected */
    }
    assert.ok(!blocked, "build local nunca se bloquea");
  });

  process.exit = origExit;
  if (exitCode !== 0) {
    console.error("\x1b[31mself-test FALLÓ\x1b[0m");
    origExit(1);
  }
  console.log("\x1b[32mself-test OK\x1b[0m");
}

module.exports = { check, PROD_PROJECT_ID, runSelfTest };
