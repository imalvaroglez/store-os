#!/usr/bin/env node
/**
 * Hard guard against cross-environment Firebase configuration.
 *
 * Localhost and Preview must use the real development project. Production must
 * use the production project. There is no local data fallback.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEV_PROJECT_ID = "store-os-dev";
const PROD_PROJECT_ID = "store-os-f7cf8";
const REQUIRED_VARS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

function fail(msg) {
  console.error(`\x1b[31m[check-env] BLOQUEADO:\x1b[0m ${msg}`);
  console.error(
    "[check-env] Local/Preview → store-os-dev. Production → store-os-f7cf8."
  );
  process.exit(1);
}

function pass(msg) {
  console.log(`\x1b[32m[check-env] OK:\x1b[0m ${msg}`);
}

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function loadEnv(mode = "production") {
  const root = path.resolve(__dirname, "..");
  return {
    ...parseEnvFile(path.join(root, ".env")),
    ...parseEnvFile(path.join(root, ".env.local")),
    ...parseEnvFile(path.join(root, `.env.${mode}`)),
    ...parseEnvFile(path.join(root, `.env.${mode}.local`)),
    ...process.env,
  };
}

/**
 * @param {string|null|undefined} vercelEnv
 * @param {string|null|undefined} projectId
 * @param {{ emulator?: string, required?: boolean, values?: Record<string,string|undefined> }} [options]
 */
function check(vercelEnv, projectId, options = {}) {
  if (options.emulator === "true") {
    fail("VITE_FIREBASE_EMULATOR ya no es válido: todas las pruebas usan Firebase real.");
  }
  if (vercelEnv && !["development", "preview", "production"].includes(vercelEnv)) {
    fail(`VITE_VERCEL_ENV desconocido: '${vercelEnv}'. Usa development, preview o production.`);
  }

  const target = vercelEnv === "production" ? PROD_PROJECT_ID : DEV_PROJECT_ID;
  if (projectId !== target) {
    const label = vercelEnv === "production" ? "Production" : vercelEnv === "preview" ? "Preview" : "desarrollo local";
    fail(`${label} debe apuntar a ${target}; recibió '${projectId || "(vacío)"}'.`);
  }

  if (options.required) {
    const missing = REQUIRED_VARS.filter((name) => !options.values?.[name]);
    if (missing.length) fail(`faltan variables Firebase obligatorias: ${missing.join(", ")}.`);
  }

  pass(`${vercelEnv === "production" ? "Production" : vercelEnv === "preview" ? "Preview" : "Localhost"} → ${target}.`);
}

if (require.main === module) {
  if (process.argv.includes("--test")) {
    runSelfTest();
  } else {
    const mode = process.env.VITE_VERCEL_ENV === "production" ? "production" : "development";
    const env = loadEnv(mode);
    check(env.VITE_VERCEL_ENV, env.VITE_FIREBASE_PROJECT_ID, {
      emulator: env.VITE_FIREBASE_EMULATOR,
      required: true,
      values: env,
    });
  }
}

function runSelfTest() {
  const assert = require("node:assert");
  let exitCode = 0;
  const it = (name, fn) => {
    try {
      fn();
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (error) {
      console.error(`  \x1b[31m✗\x1b[0m ${name}: ${error.message}`);
      exitCode = 1;
    }
  };
  const originalExit = process.exit;
  let blocked = false;
  process.exit = (code) => {
    blocked = code !== 0;
    throw new Error("__BLOCKED__");
  };
  const expectBlocked = (name, fn) => it(name, () => {
    blocked = false;
    try { fn(); } catch { /* expected */ }
    assert.ok(blocked, "debería bloquear");
  });
  const expectAllowed = (name, fn) => it(name, () => {
    blocked = false;
    try { fn(); } catch { /* expected */ }
    assert.ok(!blocked, "no debería bloquear");
  });

  expectAllowed("localhost + dev", () => check(undefined, DEV_PROJECT_ID));
  expectBlocked("localhost + prod", () => check(undefined, PROD_PROJECT_ID));
  expectBlocked("localhost sin proyecto", () => check(undefined, undefined));
  expectAllowed("preview + dev", () => check("preview", DEV_PROJECT_ID));
  expectBlocked("preview + prod", () => check("preview", PROD_PROJECT_ID));
  expectBlocked("production + dev", () => check("production", DEV_PROJECT_ID));
  expectAllowed("production + prod", () => check("production", PROD_PROJECT_ID));
  expectBlocked("ambiente desconocido", () => check("staging", DEV_PROJECT_ID));
  expectBlocked("emulator flag", () => check(undefined, DEV_PROJECT_ID, { emulator: "true" }));

  process.exit = originalExit;
  if (exitCode) originalExit(1);
  console.log("\x1b[32mself-test OK\x1b[0m");
}

module.exports = { check, loadEnv, DEV_PROJECT_ID, PROD_PROJECT_ID };
