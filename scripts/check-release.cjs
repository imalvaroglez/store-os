#!/usr/bin/env node
// Release guard (#179): a production release must carry an incremented version
// WITH its notes. The reference is what production ALREADY serves — the deploy
// stamps <meta name="store-os-version"> into every HTML entry (vite.config.ts),
// so probing the live production HTML compares the real user-facing artifact,
// not a bookkeeping copy. No GitHub API, no write permissions, no new services.
//
// Usage:
//   node scripts/check-release.cjs [--probe-url https://…] [--root <dir>]
//
// Exit 0 = ok (warnings allowed only while production predates this feature).
// Exit 1 = the release must be stopped: bump src/releases/releases.json and
//          package.json together, with notes for the new version.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function parseSemver(value) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** >0 if a>b, <0 if a<b, 0 if equal, null if either is not strict semver. */
function compareSemver(a, b) {
  const A = parseSemver(a);
  const B = parseSemver(b);
  if (!A || !B) return null;
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
}

/** Local, dependency-free checks over package.json + src/releases/releases.json. */
function validateLocal(root) {
  const errors = [];
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const releases = JSON.parse(fs.readFileSync(path.join(root, "src/releases/releases.json"), "utf8"));
  if (!Array.isArray(releases) || releases.length === 0) {
    return { errors: ["src/releases/releases.json debe tener al menos una versión."], releases };
  }
  const pkgVersion = parseSemver(pkg.version);
  if (!pkgVersion) errors.push(`package.json tiene versión "${pkg.version}" que no es semver estricto (X.Y.Z).`);
  releases.forEach((release, i) => {
    const tag = `Versión ${release.version ?? "(vacía)"} (entrada ${i + 1})`;
    if (!parseSemver(release.version)) errors.push(`${tag}: no es semver estricto (X.Y.Z).`);
    if (!/^\d{4}\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])$/.test(String(release.date ?? ""))) {
      errors.push(`${tag}: la fecha "${release.date}" no tiene el formato AAAA.MM.DD válido.`);
    }
    if (!release.title || !String(release.title).trim()) errors.push(`${tag}: falta el título.`);
    if (!Array.isArray(release.notes) || release.notes.length === 0 || release.notes.some((n) => !String(n).trim())) {
      errors.push(`${tag}: necesita al menos una nota no vacía.`);
    }
  });
  for (let i = 1; i < releases.length; i++) {
    const cmp = compareSemver(releases[i - 1].version, releases[i].version);
    if (cmp === null) continue; // already reported as a semver error above
    if (cmp <= 0) errors.push(`El historial debe ir de nueva a antigua: ${releases[i - 1].version} no es mayor que ${releases[i].version}.`);
  }
  const latest = releases[0].version;
  if (pkgVersion && compareSemver(latest, pkg.version) !== 0) {
    errors.push(`package.json (${pkg.version}) y las notas (${latest}) divergen: sube los dos juntos.`);
  }
  return { errors, releases };
}

/** Extracts a meta tag's content from served HTML. null = meta absent. */
function extractMeta(html, name) {
  const m = new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"\\s*/?>`, "i").exec(html);
  return m ? m[1] : null;
}

/** Extracts the served version from production HTML. null = meta absent. */
function extractServedVersion(html) {
  return extractMeta(html, "store-os-version");
}

async function probe(url) {
  const response = await fetch(url, { redirect: "follow", headers: { "cache-control": "no-cache" } });
  if (!response.ok) throw new Error(`production respondió ${response.status} al pedir ${url}`);
  const html = await response.text();
  return { html, version: extractServedVersion(html), hasBuildId: extractMeta(html, "x-build") != null };
}

async function main() {
  const args = process.argv.slice(2);
  const probeUrl = args.includes("--probe-url") ? args[args.indexOf("--probe-url") + 1] : null;
  const root = args.includes("--root") ? path.resolve(args[args.indexOf("--root") + 1]) : process.cwd();

  const { errors, releases } = validateLocal(root);
  const latest = releases?.[0]?.version;
  if (probeUrl) {
    try {
      const served = await probe(probeUrl);
      if (served.version == null) {
        // Transition window, tightly bounded (review #194 F2): a legacy Store OS
        // artifact proves itself with <meta x-build> (stamped since the refresh
        // work). Anything else — a maintenance page, a proxy error with HTTP
        // 200 — has NO Store OS identity and blocks the release.
        if (!served.hasBuildId) {
          errors.push(`La respuesta de producción no tiene identidad de Store OS (sin store-os-version ni x-build). No se libera contra una página desconocida.`);
        } else {
          console.warn(`⚠ Producción sirve un build legado sin <meta store-os-version> (anterior a #194). Única transición permitida: este release estrena el meta; el próximo sondeo exigirá versión.`);
        }
      } else if (parseSemver(latest) && compareSemver(latest, served.version) <= 0) {
        errors.push(`Producción ya sirve ${served.version} y esta liberación llevaría ${latest}: incrementa la versión y agrega sus notas.`);
      }
    } catch (err) {
      errors.push(`No se pudo verificar la versión viva de producción (${err.message}). No se libera a ciegas.`);
    }
  }
  if (errors.length > 0) {
    console.error("✖ Control de liberación:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`✔ Control de liberación: ${latest} lista (notas completas${probeUrl ? ", referencia de producción verificada" : ""}).`);
}

if (require.main === module) main();

module.exports = { parseSemver, compareSemver, validateLocal, extractMeta, extractServedVersion, probe };
