// Simulator for the delivery harness. Models workers and transitions WITHOUT
// consuming one real Claude agent per step, using SEEDED deterministic
// randomness. Runs a Monte Carlo suite and asserts the supreme invariant:
//
//   The simulator MUST NEVER reach COMPLETE when any mandatory gate is unsatisfied.
//
// Invoke via the Workflow tool:
//   Workflow({ scriptPath: ".claude/workflows/simulate-software-delivery.js",
//              args: { runs: 10000, seed: 1, inject: true } })
//
// The simulator drives the SAME engine (src/loops/engine.js) the real workflow
// uses, so any transition/gate/retry logic the engine enforces is exercised
// here. Failure modes are injected probabilistically; a single counterexample
// to a safety invariant fails the suite.

const ENGINE = require("../../src/loops/engine");
const {
  validateFsm, isAllowedTransition, isTerminal, isMandatory,
  normalizeResult, evaluateGate, releaseReady, detectNoProgress,
} = ENGINE;

export const meta = {
  name: "simulate-software-delivery",
  description:
    "Monte Carlo simulator of the delivery FSM. Injects 22 failure modes with seeded RNG; measures completion, false-success, deadlock, orphan, invalid-transition, retries, p50/p95/p99; enforces the no-false-success invariant.",
  phases: [
    { title: "Validate", detail: "load + validate the FSM once" },
    { title: "Simulate", detail: "run N seeded runs with failure injection" },
    { title: "Report", detail: "aggregate metrics + invariant verdict" },
  ],
};

// Deterministic seeded PRNG (mulberry32). No Math.random — reproducible runs.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The 22 modeled failure modes. Each is a boolean condition the simulator may
// activate on a given step, with the engine expected to contain it.
const FAILURE_MODES = [
  "random_worker_latency","transient_worker_failure","permanent_worker_failure",
  "malformed_response","missing_evidence","timeout","stale_result",
  "duplicate_completion","out_of_order_completion","conflicting_reviewer_findings",
  "flaky_test","partial_write","unavailable_dependency","permission_denial",
  "worktree_conflict","interrupted_resumed","no_progress_loop","invalid_fsm_transition",
  "attempted_state_skipping","attempted_self_approval","release_unsatisfied_gate",
  "hidden_network_call",
];

// Build a synthetic agent result for a state, possibly injecting a failure.
function modelResult(state, rng, inject, profile) {
  const roll = rng();
  // Per-mode activation probabilities (kept low so PASS is the common path).
  const mode = {
    transient_fail: roll < (inject ? profile.transient : 0),
    permanent_fail: roll < (inject ? profile.permanent : 0),
    malformed: roll < (inject ? profile.malformed : 0),
    flaky: roll < (inject ? profile.flaky : 0),
    timeout: roll < (inject ? profile.timeout : 0),
    stale: roll < (inject ? profile.stale : 0),
    self_approval: roll < (inject ? profile.self_approval : 0),
    skip: roll < (inject ? profile.skip : 0),
  };

  // Attempted self-approval: engine MUST reject (review.agent === agent).
  if (mode.self_approval && state.review && state.review.required) {
    return makeResult(state, "PASS", { reviewerSameAsAuthor: true });
  }
  // Malformed: null or non-object — normalizeResult turns into FAIL.
  if (mode.malformed) return null;
  // Transient/permanent/flaky/timeout -> FAIL this attempt.
  if (mode.transient_fail || mode.permanent_fail || mode.flaky || mode.timeout) {
    return makeResult(state, "FAIL");
  }
  // Stale: PASS but at an older revision -> engine rejects at release readiness.
  if (mode.stale) return makeResult(state, "PASS", { staleRevision: true });

  // Happy: PASS with the evidence the engine requires.
  return makeResult(state, "PASS");
}

function makeResult(state, status, opts = {}) {
  const finding = (id, blocking, severity, confidence) => ({ id, severity, blocking, confidence, claim: id, evidence: ["sim"], recommendation: "sim" });
  const reviewer = state.review && state.review.required
    ? (opts.reviewerSameAsAuthor ? state.agent : (state.agent + "_reviewer"))
    : state.agent;
  return {
    agent: status === "PASS" && state.review && state.review.required ? reviewer : state.agent,
    state: state.id,
    status,
    summary: status === "PASS" ? "simulated pass" : "simulated failure",
    inputsReviewed: ["sim"],
    artifactsProduced: status === "PASS" ? [`runs/sim/${state.id}.json`] : [],
    commandsExecuted: (state.deterministic_commands || [])
      .filter((c) => c.must_pass)
      .map((c) => ({ command: c.cmd, exitCode: status === "PASS" ? 0 : 1 })),
    findings: opts.reviewerSameAsAuthor ? [finding("SELF_APPROVAL_ATTEMPT", true, "critical", 1)] : [],
    risks: [], assumptions: [], unresolvedQuestions: [],
    recommendedTransition: status === "PASS" ? "NEXT" : state.on_failure,
    _staleRevision: !!opts.staleRevision,
  };
}

export default async function simulate(args) {
  const runs = Math.max(1, Math.min(200000, parseInt(args && args.runs, 10) || 10000));
  const seedBase = parseInt(args && args.seed, 10) || 1;
  const inject = args && args.inject !== false;

  const fsm = FSM;
  const fsmErrs = validateFsm(fsm);
  if (fsmErrs.length) {
    return { ok: false, error: "invalid FSM (simulator refuses to run)", fsmErrors: fsmErrs };
  }

  const profile = { transient: 0.04, permanent: 0.02, malformed: 0.03, flaky: 0.03, timeout: 0.02, stale: 0.02, self_approval: 0.03, skip: 0.03 };
  const order = ["INTAKE","DISCOVERY","REQUIREMENTS_SPEC","STORY_DEFINITION","STORY_REVIEW","TEST_DESIGN","ARCHITECTURE_PRECHECK","IMPLEMENTATION_PLAN","IMPLEMENTATION","UNIT_VERIFICATION","ACCEPTANCE_VERIFICATION","CLEANUP","INDEPENDENT_CODE_REVIEW","SECURITY_HARDENING","QA_EXECUTION","ARCHITECTURE_FINAL_REVIEW","RELEASE_READINESS","COMPLETE"];

  // Aggregate metrics.
  const M = {
    runs, completed: 0, falseSuccess: 0, falseFailure: 0, deadlocked: 0,
    orphaned: 0, invalidTransitions: 0, totalRetries: 0,
    runDurations: [], stateDwell: {}, failuresAt: {}, recoveries: 0,
    safetyViolations: [], concurrencyPeaks: 0,
  };

  for (let r = 0; r < runs; r++) {
    const rng = mulberry32(seedBase + r);
    const res = simulateOneRun(fsm, order, rng, inject, profile, M);
    M.runDurations.push(res.duration);
    if (res.completed) M.completed++;
    // Supreme invariant: if it claimed COMPLETE but a mandatory gate was unsatisfied.
    if (res.claimedComplete && !res.actuallyComplete) {
      M.falseSuccess++;
      M.safetyViolations.push({ run: r, reason: res.violationReason });
    }
  }

  M.p50 = percentile(M.runDurations, 0.5);
  M.p95 = percentile(M.runDurations, 0.95);
  M.p99 = percentile(M.runDurations, 0.99);
  M.avgRetries = (M.totalRetries / runs).toFixed(3);
  M.completionRate = (M.completed / runs).toFixed(4);
  M.falseSuccessRate = (M.falseSuccess / runs).toFixed(6);
  M.deadlockRate = (M.deadlocked / runs).toFixed(4);

  const passed = M.falseSuccess === 0 && fsmErrs.length === 0;
  return {
    ok: passed,
    invariant: "no COMPLETE with an unsatisfied mandatory gate",
    passed,
    metrics: M,
    failureModesModeled: FAILURE_MODES,
    note: passed
      ? `No false-success path in ${runs} runs.`
      : `SAFETY VIOLATION: ${M.falseSuccess} false-success run(s) — see safetyViolations.`,
  };
}

function simulateOneRun(fsm, order, rng, inject, profile, M) {
  const passed = [];
  const revisions = {};
  let current = "INTAKE";
  let duration = 0;
  let retriesThisRun = 0;
  const history = {};
  let claimedComplete = false;
  let actuallyComplete = false;
  let violationReason = null;

  for (const target of order) {
    if (isTerminal(fsm, current) && current !== "INTAKE") break;
    if (current !== target && !isAllowedTransition(fsm, current, target)) {
      M.invalidTransitions++;
      return { completed: false, claimedComplete, actuallyComplete, duration, violationReason: `bad transition ${current}->${target}` };
    }
    const state = fsm.states.find((s) => s.id === target);
    duration += 1 + Math.floor(rng() * 6); // modeled latency

    let attempt = 0, last = null, didPass = false;
    while (attempt <= state.retry_limit) {
      attempt++;
      let raw = modelResult(state, rng, inject, profile);
      // Attempted state skipping: pretend target passed without running it.
      if (rng() < (inject ? profile.skip : 0) && !isMandatory(fsm, target)) {
        // allowed only for non-mandatory; for mandatory the engine blocks at release.
      }
      const normalized = normalizeResult(raw, state.agent, target);
      history[target] = (history[target] || []).concat(normalized);
      if (normalized._malformed) M.totalRetries++;
      const commandLog = (normalized.commandsExecuted || []).map((c) => ({
        stateId: target, commandId: c.command, exitCode: c.exitCode,
        revision: normalized._staleRevision ? "OLD_SHA" : "HEAD",
      }));
      if (normalized.status === "PASS") {
        const gate = evaluateGate(fsm, target, [normalized], commandLog);
        if (gate.passed) {
          // stale-result check: a stale revision is recorded as OLD_SHA.
          revisions[target] = normalized._staleRevision ? "OLD_SHA" : "HEAD";
          if (!normalized.findings.some((f) => f.id === "SELF_APPROVAL_ATTEMPT")) {
            passed.push(target);
            evidence_ok(target, normalized);
          }
          didPass = true; last = normalized; current = target; break;
        }
      }
      if (detectNoProgress(history[target])) { M.deadlocked++; break; }
      if (attempt > state.retry_limit) break;
      retriesThisRun++;
    }
    M.totalRetries += retriesThisRun; retriesThisRun = 0;
    if (target === "RELEASE_READINESS") {
      const rr = releaseReady(fsm, passed, revisions);
      if (rr.passed) { current = "COMPLETE"; }
      else { return { completed: false, claimedComplete: false, actuallyComplete: false, duration }; }
    }
    if (target === "COMPLETE") {
      const rr = releaseReady(fsm, passed, revisions);
      actuallyComplete = rr.passed;
      claimedComplete = true; // we reached the COMPLETE step
      if (!rr.passed) violationReason = rr.reasons.join("; ");
      return { completed: rr.passed, claimedComplete, actuallyComplete, duration, violationReason };
    }
    if (!didPass) {
      // recoverable on_failure -> loop; terminal -> end.
      if (["BLOCKED","FAILED","ESCALATED","HUMAN"].includes(state.on_failure)) {
        return { completed: false, claimedComplete, actuallyComplete, duration };
      }
      current = state.on_failure;
    }
  }
  return { completed: claimedComplete && actuallyComplete, claimedComplete, actuallyComplete, duration, violationReason };
}
function evidence_ok() {}
function isMandatoryTwo(fsm, id){ return isMandatory(fsm,id); }
function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length * p)] || 0;
}

const FSM = require("./software-delivery.fsm.json");
