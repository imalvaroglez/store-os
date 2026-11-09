#!/usr/bin/env node
// #227 — Sev 1 same-SHA CI reuse guard. A Sev-1 release dispatch may skip the
// ~12-minute suites ONLY when the exact commit being dispatched already passed
// them on a push to main. This script FAILS CLOSED: any missing evidence, any
// mismatch, any doubt → exit 1 → no deploy (deploy/deploy-rules gate on this
// job's success).
//
// What it proves before allowing reuse:
//   1. --sha is a full 40-char commit id.
//   2. The dispatched commit IS the current tip of origin/main (freshness:
//      containment releases the hotfix that just landed, never a stale SHA).
//   3. At least one COMPLETED + SUCCESSFUL run of THIS workflow ("CI") exists
//      for that exact sha with event == "push" (main provenance — never a PR).
//   4. That run's jobs include "build-test" AND "rules-and-e2e", both
//      "success" — a documentary-only push yields a green run WITHOUT those
//      jobs and must NOT qualify as reusable CI.
//
// Usage (from the workflow, on the dispatched commit):
//   node scripts/check-sev1-ci-reuse.cjs --repo owner/repo --sha $GITHUB_SHA
//   GH_TOKEN with actions:read is required (the workflow's GITHUB_TOKEN has it).
// Offline pure-logic check: node scripts/check-sev1-ci-reuse.cjs --self-test
"use strict";

const { execFileSync } = require("node:child_process");

const REQUIRED_JOBS = ["build-test", "rules-and-e2e"];
const WORKFLOW_NAME = "CI";
// H1 (adversarial): identity is pinned by PATH, not just display name — a
// foreign workflow named "CI" must never supply release evidence.
const WORKFLOW_PATH = ".github/workflows/ci.yml";

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function failWith(message) {
  console.error(message);
  process.exit(1);
}

/**
 * Pure decision over already-fetched evidence. Everything the guard concludes
 * lives here so --self-test can pin it without touching the network.
 * @param {{sha: string, headSha: string, runs: Array<any>, jobsByRunId: Record<string, Array<any>>}} input
 * @returns {{ok: boolean, reasons: string[], evidence: string[]}}
 */
function verifyReusableCi({ sha, headSha, runs, jobsByRunId }) {
  // Structural reasons deny the reuse no matter what evidence exists; per-run
  // notes are informational — a non-reusable sibling run (e.g. the same SHA
  // pushed to a backup branch) must NOT deny a release that has valid
  // evidence (H2, adversarial: order-dependent denial).
  const structuralReasons = [];
  const notes = [];
  const evidence = [];
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) {
    structuralReasons.push(`--sha no es un id de commit completo (40 hex): "${sha}"`);
  }
  if (!headSha) {
    structuralReasons.push("no se pudo resolver la punta de origin/main");
  } else if (sha && headSha !== sha) {
    structuralReasons.push(`el commit despachado (${sha ? sha.slice(0, 8) : "?"}) no es la punta de origin/main (${headSha.slice(0, 8)}): despacha desde la punta tras integrar el hotfix`);
  }
  const qualifying = (runs ?? []).filter(
    (run) =>
      run.head_sha === sha &&
      run.name === WORKFLOW_NAME &&
      run.path === WORKFLOW_PATH &&
      run.event === "push" &&
      run.head_branch === "main" &&
      run.status === "completed" &&
      run.conclusion === "success"
  );
  if (qualifying.length === 0) {
    structuralReasons.push(`no hay corrida COMPLETADA y EXITOSA de "${WORKFLOW_NAME}" (${WORKFLOW_PATH}, push de main) para este commit`);
  }
  let reusableRun = null;
  for (const run of qualifying) {
    const jobs = jobsByRunId[run.id] ?? [];
    const blocking = [];
    for (const required of REQUIRED_JOBS) {
      // H3 (adversarial): duplicate job names must never average out to
      // success — uniqueness is part of the evidence.
      const matches = jobs.filter((job) => job.name === required);
      if (matches.length === 0) blocking.push(`sin job ${required}`);
      else if (matches.length > 1) blocking.push(`${required} duplicado (${matches.length} jobs con ese nombre)`);
      else if (matches[0].conclusion !== "success") blocking.push(`${required}=${matches[0].conclusion}`);
    }
    if (blocking.length === 0) {
      reusableRun = run;
      evidence.push(`run ${run.id} (push de main, exitoso): ${REQUIRED_JOBS.join(" y ")} en success — ${run.html_url ?? run.url ?? ""}`);
      break;
    }
    notes.push(`run ${run.id} no reutilizable: ${blocking.join(" · ")}`);
  }
  if (!reusableRun && qualifying.length > 0) {
    structuralReasons.push("ninguna corrida del commit tiene ambas suites únicas y en success (un push solo-documentación da run verde SIN esos jobs: no cuenta)");
  }
  return { ok: structuralReasons.length === 0 && reusableRun !== null, reasons: [...structuralReasons, ...notes], evidence };
}

let SELF_TEST_CHECKS = 0;

function assertEqual(actual, expected, label) {
  SELF_TEST_CHECKS += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failWith(`self-test FALLÓ (${label}): esperaba ${JSON.stringify(expected)}, obtuvo ${JSON.stringify(actual)}`);
  }
}

function selfTest() {
  const sha = "a".repeat(40);
  const run = (id, overrides = {}) => ({
    id,
    name: WORKFLOW_NAME,
    path: WORKFLOW_PATH,
    event: "push",
    head_branch: "main",
    status: "completed",
    conclusion: "success",
    head_sha: sha,
    ...overrides,
  });
  const jobs = (id, overrides = {}) => ({ [id]: REQUIRED_JOBS.map((name) => ({ name, conclusion: "success" })), ...overrides });
  // Happy path: same-sha push run with both suites green.
  assertEqual(verifyReusableCi({ sha, headSha: sha, runs: [run(101)], jobsByRunId: jobs(101) }).ok, true, "camino verde");
  // Documentary-only push: green run without the suite jobs → refuse.
  assertEqual(
    verifyReusableCi({ sha, headSha: sha, runs: [run(102)], jobsByRunId: { 102: [{ name: "env-select", conclusion: "success" }] } }).ok,
    false,
    "push solo-documentación no reutilizable"
  );
  // rules-and-e2e failed → refuse.
  assertEqual(
    verifyReusableCi({ sha, headSha: sha, runs: [run(103)], jobsByRunId: { 103: [{ name: "build-test", conclusion: "success" }, { name: "rules-and-e2e", conclusion: "failure" }] } }).ok,
    false,
    "suite fallida no reutilizable"
  );
  // PR provenance → refuse even if green.
  assertEqual(verifyReusableCi({ sha, headSha: sha, runs: [run(104, { event: "pull_request" })], jobsByRunId: jobs(104) }).ok, false, "corrida de PR no cuenta");
  // Stale dispatch (sha is not main's tip) → refuse.
  assertEqual(verifyReusableCi({ sha, headSha: "b".repeat(40), runs: [run(105)], jobsByRunId: jobs(105) }).ok, false, "sha no es la punta de main");
  // Run for a different sha must not be mixed in.
  assertEqual(verifyReusableCi({ sha, headSha: sha, runs: [run(106, { head_sha: "c".repeat(40) })], jobsByRunId: jobs(106) }).ok, false, "corrida de otro commit no cuenta");
  // Malformed sha → refuse.
  assertEqual(verifyReusableCi({ sha: "abc123", headSha: "abc123", runs: [], jobsByRunId: {} }).ok, false, "sha malformado");
  // No runs at all → refuse.
  assertEqual(verifyReusableCi({ sha, headSha: sha, runs: [], jobsByRunId: {} }).ok, false, "sin corridas");
  // Jobs from ANOTHER run must not rescue a doc-only run (keyed strictly).
  assertEqual(
    verifyReusableCi({ sha, headSha: sha, runs: [run(107)], jobsByRunId: { 108: [{ name: "build-test", conclusion: "success" }, { name: "rules-and-e2e", conclusion: "success" }] } }).ok,
    false,
    "jobs de otra corrida no rescatan"
  );
  // H1: a foreign workflow NAMED "CI" (different path) must not qualify.
  assertEqual(verifyReusableCi({ sha, headSha: sha, runs: [run(109, { path: ".github/workflows/escalation.yml" })], jobsByRunId: jobs(109) }).ok, false, "workflow homónimo ajeno no cuenta");
  // H2: a non-reusable sibling run BEFORE the good one must not deny the release.
  assertEqual(
    verifyReusableCi({
      sha,
      headSha: sha,
      runs: [run(110, { conclusion: "failure" }), run(111)],
      jobsByRunId: { ...jobs(111), 110: [{ name: "build-test", conclusion: "success" }] },
    }).ok,
    true,
    "hermano fallido antes del bueno no deniega"
  );
  // Same-SHA run pushed from a non-main branch: neither approves nor denies.
  assertEqual(
    verifyReusableCi({ sha, headSha: sha, runs: [run(112, { head_branch: "main-backup" }), run(113)], jobsByRunId: { ...jobs(113), 112: [{ name: "env-select", conclusion: "success" }] } }).ok,
    true,
    "corrida de otra rama ni aprueba ni deniega"
  );
  // H3: duplicate required-job names must not average out to success.
  assertEqual(
    verifyReusableCi({
      sha,
      headSha: sha,
      runs: [run(114)],
      jobsByRunId: { 114: [{ name: "build-test", conclusion: "success" }, { name: "build-test", conclusion: "failure" }, { name: "rules-and-e2e", conclusion: "success" }] },
    }).ok,
    false,
    "jobs duplicados no promedian"
  );
}

async function main() {
  const repo = argumentValue("--repo");
  const sha = argumentValue("--sha");
  if (!repo || !sha) failWith("Uso: node scripts/check-sev1-ci-reuse.cjs --repo owner/repo --sha <40-hex> (o --self-test)");
  // Validate BEFORE any network call: malformed input must never reach a query
  // string (review F4 — the workflow always passes GITHUB_SHA, but the guard
  // owns its own inputs).
  if (!/^[0-9a-f]{40}$/.test(sha)) failWith(`--sha no es un id de commit completo (40 hex): "${sha}"`);
  // Freshness: the dispatched commit must be origin/main's tip. The workflow
  // checks out the dispatch ref with fetch-depth 0.
  let headSha = "";
  try {
    headSha = execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim();
  } catch {
    failWith("no se pudo resolver origin/main (checkout con fetch-depth 0 requerido)");
  }
  const gh = (args) =>
    JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8", env: { ...process.env } }));
  // Pagination note (review F3): per_page=100 WITHOUT following Link links.
  // Truncation can only LOSE evidence (unjustified deny), never approve
  // without proof — fail-closed by construction. A single commit exceeding
  // 100 runs/jobs would be extraordinary.
  const runsPage = gh([`repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`]);
  const runs = runsPage.workflow_runs ?? [];
  const jobsByRunId = {};
  for (const run of runs) {
    if (run.name !== WORKFLOW_NAME) continue;
    const jobsPage = gh([`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`]);
    jobsByRunId[run.id] = jobsPage.jobs ?? [];
  }
  const verdict = verifyReusableCi({ sha, headSha, runs, jobsByRunId });
  for (const line of verdict.evidence) console.log(`✓ ${line}`);
  for (const reason of verdict.reasons) console.error(`✗ ${reason}`);
  if (!verdict.ok) {
    console.error("REUSO DENEGADO: el CI del mismo SHA no está probado; corre las suites o despacha desde la punta de main.");
    process.exit(1);
  }
  console.log("REUSO APROBADO: build-test y rules-and-e2e verdes por el push de este mismo commit. El release continúa con sus demás compuertas (release guard de versión+notas incluido).");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  console.log(`self-test OK (${SELF_TEST_CHECKS} verificaciones)`);
  process.exit(0);
}

main().catch((error) => {
  failWith(`Fallo la verificación Sev-1: ${error && error.message ? error.message : error}`);
});
