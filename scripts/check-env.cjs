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
 *   VITE_VERCEL_ENV === 'preview'     + projectId !== DEV   => FAIL
 *   VITE_VERCEL_ENV === 'production'  + projectId !== PROD  => FAIL
 *   local build without exactly the DEV project ID            => FAIL
 *
 * VITE_VERCEL_ENV is injected automatically by Vercel per deployment target.
 */
"use strict";

const PROD_PROJECT_ID = "store-os-f7cf8";
const DEV_PROJECT_ID = "store-os-dev";

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

// Vite loads .env files after npm pre-scripts run. Read them here so the guard
// validates the same Firebase target before dev and preview servers start.
function loadLocalEnv() {
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..");
  const loaded = {};
  for (const file of [".env", ".env.local"]) {
    const fullPath = path.join(root, file);
    if (!fs.existsSync(fullPath)) continue;
    for (const line of fs.readFileSync(fullPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, "").trim();
      }
      loaded[match[1]] = value;
    }
  }
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function checkFirebaseAliases() {
  const path = require("path");
  const fs = require("fs");
  const configPath = path.join(__dirname, "..", ".firebaserc");
  let projects;
  try {
    projects = JSON.parse(fs.readFileSync(configPath, "utf8")).projects;
  } catch {
    fail("no se pudo leer .firebaserc");
  }
  const allowedProjectIds = new Set([DEV_PROJECT_ID, PROD_PROJECT_ID]);
  const aliases = Object.values(projects || {});
  if (
    projects?.default !== DEV_PROJECT_ID ||
    projects?.dev !== DEV_PROJECT_ID ||
    projects?.production !== PROD_PROJECT_ID ||
    aliases.some((projectId) => !allowedProjectIds.has(projectId))
  ) {
    fail(
      `.firebaserc debe usar ${DEV_PROJECT_ID} como predeterminado/dev y ${PROD_PROJECT_ID} como alias production.`
    );
  }
  pass(`.firebaserc → dev por defecto; production → ${PROD_PROJECT_ID}.`);
}

function checkFirebaseConfig(env) {
  const required = [
    "VITE_FIREBASE_API_KEY",
    "VITE_FIREBASE_AUTH_DOMAIN",
    "VITE_FIREBASE_PROJECT_ID",
    "VITE_FIREBASE_STORAGE_BUCKET",
    "VITE_FIREBASE_SENDER_ID",
    "VITE_FIREBASE_APP_ID",
  ];
  const missing = required.filter((key) => !String(env[key] || "").trim());
  if (missing.length) fail(`faltan variables públicas de Firebase: ${missing.join(", ")}.`);
  if (env.VITE_FIREBASE_EMULATOR && !["true", "false"].includes(env.VITE_FIREBASE_EMULATOR)) {
    fail("VITE_FIREBASE_EMULATOR solo puede ser 'true' o 'false'.");
  }
  if (env.VITE_FIREBASE_EMULATOR === "true" && env.VITE_VERCEL_ENV) {
    fail("El emulador solo puede usarse en desarrollo local, no en Preview ni producción.");
  }
}

/**
 * @param {string|null|undefined} vercelEnv
 * @param {string|null|undefined} projectId
 */
function check(vercelEnv, projectId) {
  if (!vercelEnv) {
    if (projectId !== DEV_PROJECT_ID) {
      fail(`desarrollo local con projectId '${projectId || "sin configurar"}'. Debe usar ${DEV_PROJECT_ID}.`);
    }
    pass(`desarrollo local → ${DEV_PROJECT_ID}`);
    return;
  }

  if (vercelEnv === "preview" || vercelEnv === "development") {
    if (projectId !== DEV_PROJECT_ID) {
      fail(
        `deploy de ${vercelEnv} con projectId '${projectId}'. ` +
          `Preview y Development deben apuntar a ${DEV_PROJECT_ID}.`
      );
    }
    pass(`${vercelEnv} → projectId ${projectId}.`);
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

  fail(`VITE_VERCEL_ENV='${vercelEnv}' no es un destino reconocido.`);
}

// --- Entry point ---
if (require.main === module) {
  if (process.argv.includes("--test")) {
    runSelfTest();
  } else {
    loadLocalEnv();
    checkFirebaseAliases();
    checkFirebaseConfig(process.env);
    const localCommand = process.argv.includes("--local");
    const vercelEnv = localCommand ? undefined : process.env.VITE_VERCEL_ENV;
    check(vercelEnv, process.env.VITE_FIREBASE_PROJECT_ID);
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

  it("preview + unrelated projectId => blocked", () => {
    blocked = false;
    try {
      check("preview", "another-project");
    } catch (e) {
      /* expected */
    }
    assert.ok(blocked, "Preview debe usar exactamente store-os-dev");
  });

  it("preview + dev projectId => not blocked", () => {
    blocked = false;
    try {
      check("preview", DEV_PROJECT_ID);
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
      check("production", DEV_PROJECT_ID);
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

  it("local + production projectId => blocked", () => {
    blocked = false;
    try {
      check(undefined, PROD_PROJECT_ID);
    } catch (e) {
      /* expected */
    }
    assert.ok(blocked, "El desarrollo local no debe apuntar a producción");
  });

  it("local + dev projectId => not blocked", () => {
    blocked = false;
    try {
      check(undefined, DEV_PROJECT_ID);
    } catch (e) {
      /* expected */
    }
    assert.ok(!blocked, "El desarrollo local debe aceptar store-os-dev");
  });

  it("local without dev project configured => blocked", () => {
    blocked = false;
    try {
      check(undefined, undefined);
    } catch (e) {
      /* expected */
    }
    assert.ok(blocked, "El desarrollo local debe exigir store-os-dev");
  });

  it("unknown Vercel environment => blocked", () => {
    blocked = false;
    try {
      check("staging", DEV_PROJECT_ID);
    } catch (e) {
      /* expected */
    }
    assert.ok(blocked, "Un destino sin regla explícita debe bloquearse");
  });

  it("Firebase CLI aliases point to dev by default and production explicitly", () => {
    blocked = false;
    try {
      checkFirebaseAliases();
    } catch (e) {
      /* expected */
    }
    assert.ok(!blocked, ".firebaserc debe mantener los destinos aprobados");
  });

  process.exit = origExit;
  if (exitCode !== 0) {
    console.error("\x1b[31mself-test FALLÓ\x1b[0m");
    origExit(1);
  }
  console.log("\x1b[32mself-test OK\x1b[0m");
}

module.exports = { check, checkFirebaseAliases, DEV_PROJECT_ID, PROD_PROJECT_ID, runSelfTest };
