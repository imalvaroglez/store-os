#!/usr/bin/env node
/**
 * Drift alarm: compare the DEPLOYED Firestore/Storage rules of each backend
 * against the repo's firestore.rules / storage.rules.
 *
 * Born from the 2026-08-11 incident: prod ran three-week-old rules while the
 * repo evolved (CI never deployed rules; nothing compared deployed vs repo),
 * which surfaced as silently-denied public-catalog writes. CI now deploys
 * rules on every push to main (deploy-rules job); this script is the OPERATOR
 * alarm for anything that bypasses CI (console edits, manual deploys):
 *
 *   node scripts/check-rules-deployed.cjs                    # both backends
 *   node scripts/check-rules-deployed.cjs --project store-os-f7cf8
 *
 * Auth (like seed-dev.cjs): ADC via `gcloud auth print-access-token`, or pass
 * --token. Calls the Firebase Rules API (read-only). Exit 1 on any drift.
 */
"use strict";

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const BACKENDS = ["store-os-f7cf8", "store-os-dev"];
const RULES_API = "https://firebaserules.googleapis.com/v1";

function usage() {
  console.error("uso: check-rules-deployed.cjs [--project <id>]... [--token <oauth>]");
  process.exit(2);
}

function parseArgs(argv) {
  const out = { projects: [], token: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project") out.projects.push(argv[++i]);
    else if (argv[i] === "--token") out.token = argv[++i];
    else if (argv[i] === "--test") out.test = true;
    else usage();
  }
  if (!out.projects.length) out.projects = [...BACKENDS];
  return out;
}

/** CRLF + trailing-newline normalization so hashes compare content, not line endings. */
function normalizeContent(text) {
  return text.replace(/\r\n?/g, "\n").replace(/\n+$/, "") + "\n";
}

function sha256(text) {
  return crypto.createHash("sha256").update(normalizeContent(text)).digest("hex");
}

/** First line number where two normalized texts differ (for the drift hint). */
function firstDiffLine(a, b) {
  const la = normalizeContent(a).split("\n");
  const lb = normalizeContent(b).split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return i + 1;
  }
  return 0;
}

/**
 * Map a `releases?pageSize=` listing to { 'firestore': rulesetId, 'storage': rulesetId }.
 * Release names: `cloud.firestore` and `firebase.storage/<bucket>` (the storage
 * name contains a slash, and GET-by-encoded-name is rejected by the API, so we
 * resolve via the LIST endpoint).
 */
function splitReleases(releases) {
  const out = { firestore: null, storage: null };
  for (const r of releases || []) {
    const short = r.name.split("/").pop();
    const rulesetId = (r.rulesetName || "").split("/").pop();
    if (!rulesetId) continue;
    if (short === "cloud.firestore") out.firestore = rulesetId;
    else if (short.includes(".firebasestorage.app")) out.storage = rulesetId;
  }
  return out;
}

/** Ruleset JSON → { 'firestore.rules': content, 'storage.rules': content } keyed by file name. */
function rulesetContents(ruleset) {
  const out = {};
  for (const f of (ruleset && ruleset.source && ruleset.source.files) || []) {
    if (f.name) out[f.name] = f.content || "";
  }
  return out;
}

async function fetchJson(url, token, quotaProject) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Goog-User-Project": quotaProject,
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${JSON.stringify(body).slice(0, 160)}`);
  return body;
}

/** Compare one backend; returns [{file, ok, hint}] and throws on API/shape errors. */
async function checkProject(project, token) {
  const listing = await fetchJson(`${RULES_API}/projects/${project}/releases?pageSize=100`, token, project);
  const { firestore, storage } = splitReleases(listing.releases);
  const targets = [
    { service: "firestore", rulesetId: firestore, file: "firestore.rules" },
    { service: "storage", rulesetId: storage, file: "storage.rules" },
  ];
  const results = [];
  for (const t of targets) {
    if (!t.rulesetId) {
      results.push({ project, file: t.file, ok: false, hint: "sin release desplegado" });
      continue;
    }
    const [ruleset, repoContent] = await Promise.all([
      fetchJson(`${RULES_API}/projects/${project}/rulesets/${t.rulesetId}`, token, project),
      fs.promises.readFile(path.join(REPO, t.file), "utf8"),
    ]);
    const deployed = rulesetContents(ruleset)[t.file];
    if (deployed == null) {
      results.push({ project, file: t.file, ok: false, hint: `ruleset sin archivo ${t.file}` });
      continue;
    }
    const ok = sha256(deployed) === sha256(repoContent);
    results.push({
      project,
      file: t.file,
      ok,
      hint: ok ? sha256(repoContent).slice(0, 12) : `difieren desde la línea ${firstDiffLine(deployed, repoContent)}`,
    });
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = args.token || execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8" }).trim();
  let failures = 0;
  for (const project of args.projects) {
    try {
      for (const r of await checkProject(project, token)) {
        const tag = r.ok ? "\x1b[32mOK\x1b[0m" : "\x1b[31mDRIFT\x1b[0m";
        console.log(`[check-rules] ${tag}  ${project}  ${r.file}  (${r.hint})`);
        if (!r.ok) failures++;
      }
    } catch (e) {
      console.error(`[check-rules] \x1b[31mERROR\x1b[0m ${project}: ${e.message}`);
      failures++;
    }
  }
  if (failures) {
    console.error(`[check-rules] ${failures} verificación(es) fallaron. Deploya con CI o \`firebase deploy --only firestore:rules,storage\`.`);
    process.exit(1);
  }
  console.log("[check-rules] paridad completa: desplegado == repo.");
}

if (require.main === module) {
  if (process.argv.includes("--test")) {
    runSelfTest();
  } else {
    main();
  }
}

// --- Self-test: `node scripts/check-rules-deployed.cjs --test` (no network). ---
function runSelfTest() {
  const assert = require("assert");
  let failed = 0;
  const it = (name, fn) => {
    try {
      fn();
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (e) {
      console.error(`  \x1b[31m✗\x1b[0m ${name}: ${e.message}`);
      failed++;
    }
  };

  it("normalize collapses CRLF and trailing newlines", () => {
    assert.strictEqual(normalizeContent("a\r\nb\n\n\n"), normalizeContent("a\nb\n"));
  });

  it("sha256 igual con line endings distintos, distinto con contenido distinto", () => {
    assert.strictEqual(sha256("a\r\nb"), sha256("a\nb"));
    assert.notStrictEqual(sha256("a\nb"), sha256("a\nc"));
  });

  it("firstDiffLine localiza la primera línea distinta", () => {
    assert.strictEqual(firstDiffLine("a\nb\nc", "a\nX\nc"), 2);
    assert.strictEqual(firstDiffLine("a\nb", "a\nb"), 0);
    assert.strictEqual(firstDiffLine("a\nb", "a\nb\nc"), 3);
  });

  it("splitReleases separa firestore y storage por nombre de release", () => {
    const out = splitReleases([
      { name: "projects/p/releases/cloud.firestore", rulesetName: "projects/p/rulesets/fs1" },
      { name: "projects/p/releases/firebase.storage/p.firebasestorage.app", rulesetName: "projects/p/rulesets/st1" },
      { name: "projects/p/releases/otra.cosa", rulesetName: "projects/p/rulesets/x" },
    ]);
    assert.deepStrictEqual(out, { firestore: "fs1", storage: "st1" });
  });

  it("splitReleases tolera release sin ruleset", () => {
    const out = splitReleases([{ name: "projects/p/releases/cloud.firestore" }]);
    assert.strictEqual(out.firestore, null);
  });

  it("rulesetContents extrae archivos por nombre", () => {
    const out = rulesetContents({ source: { files: [{ name: "storage.rules", content: "x" }] } });
    assert.deepStrictEqual(out, { "storage.rules": "x" });
    assert.deepStrictEqual(rulesetContents(null), {});
  });

  if (failed) {
    console.error("\x1b[31mself-test FALLÓ\x1b[0m");
    process.exit(1);
  }
  console.log("\x1b[32mself-test OK\x1b[0m");
}

module.exports = { normalizeContent, sha256, firstDiffLine, splitReleases, rulesetContents };
