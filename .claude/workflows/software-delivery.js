export const meta = {
  name: "software-delivery",
  description:
    "Execute the spec-driven delivery FSM: requirements → stories → tests → architecture → implementation → verification → review → security → QA → release, with bounded recovery and evidence.",
  phases: [
    { title: "Validate", detail: "validate FSM + inputs; open run" },
    { title: "Plan", detail: "discovery, requirements, stories, tests, architecture" },
    { title: "Build", detail: "implementation + unit/acceptance verification" },
    { title: "Review", detail: "independent review, security, QA, architecture final" },
    { title: "Release", detail: "release readiness + delivery report" },
  ],
};

// Software-delivery workflow — executes the canonical FSM.
// Convention: `export const meta` first, then a top-level await body (the
// runtime wraps the body in an async function). NO `export default`.
// NOTE: this runtime does NOT expose `args` as a global (verified by probe).
// The objective is inlined below. To re-target, edit this constant.

const objective = "Implement inventory purchase transactions per docs/superpowers/specs/2026-08-04-inventory-purchase-transactions-design.md and the 12-task plan at docs/superpowers/plans/2026-08-04-inventory-purchase-transactions.md. Build: Supplier + Purchase entities, weighted-average cost math, committed-stock, stock reservation on order creation, suppliers CRUD, purchase form, purchase list, inventory screen redesign. The spec and plan are already approved — execute the plan's TDD tasks.";

// Canonical FSM order (mirrors .claude/loops/software-delivery.fsm.yaml).
const ORDER = ["INTAKE","DISCOVERY","REQUIREMENTS_SPEC","STORY_DEFINITION","STORY_REVIEW","TEST_DESIGN","ARCHITECTURE_PRECHECK","IMPLEMENTATION_PLAN","IMPLEMENTATION","UNIT_VERIFICATION","ACCEPTANCE_VERIFICATION","CLEANUP","INDEPENDENT_CODE_REVIEW","SECURITY_HARDENING","QA_EXECUTION","ARCHITECTURE_FINAL_REVIEW","RELEASE_READINESS","COMPLETE"];
const MANDATORY = ["REQUIREMENTS_SPEC","STORY_DEFINITION","STORY_REVIEW","TEST_DESIGN","ARCHITECTURE_PRECHECK","IMPLEMENTATION_PLAN","IMPLEMENTATION","UNIT_VERIFICATION","ACCEPTANCE_VERIFICATION","CLEANUP","INDEPENDENT_CODE_REVIEW","SECURITY_HARDENING","QA_EXECUTION","ARCHITECTURE_FINAL_REVIEW","RELEASE_READINESS"];
const TERMINAL = ["COMPLETE","BLOCKED","FAILED","ESCALATED","CANCELLED"];
const PHASE_MAP = {
  INTAKE:"Validate", DISCOVERY:"Plan", REQUIREMENTS_SPEC:"Plan", STORY_DEFINITION:"Plan",
  STORY_REVIEW:"Plan", TEST_DESIGN:"Plan", ARCHITECTURE_PRECHECK:"Plan",
  IMPLEMENTATION_PLAN:"Plan", IMPLEMENTATION:"Build", UNIT_VERIFICATION:"Build",
  ACCEPTANCE_VERIFICATION:"Build", CLEANUP:"Build", INDEPENDENT_CODE_REVIEW:"Review",
  SECURITY_HARDENING:"Review", QA_EXECUTION:"Review", ARCHITECTURE_FINAL_REVIEW:"Review",
  RELEASE_READINESS:"Release", COMPLETE:"Release",
};

const runId = "run_" + Math.floor(Math.random()*1e9).toString(36);
const events = [];
const passed = [];
const revisions = {};
const history = {};
let head = "HEAD";
let current = "INTAKE";
let eventSeq = 0; // monotonic counter — Date.now()/new Date() are forbidden in workflow scripts

function isTerminal(id) { return TERMINAL.includes(id); }

function normalize(res, state) {
  if (!res || typeof res !== "object" || !res.status || !res.summary) {
    return { state, status: "FAIL", summary: "Malformed/missing agent result — failure, not empty-pass.",
      artifactsProduced: [], findings: [{ blocking: true, severity: "critical", confidence: 1, id: "MALFORMED" }],
      _malformed: true };
  }
  return res;
}

function noProgress(hist) {
  if (hist.length < 2) return false;
  if (hist[hist.length-1].status === "PASS") return false;
  const sig = (r) => JSON.stringify((r.artifactsProduced||[]).concat(r.findings||[]));
  return sig(hist[hist.length-1]) === sig(hist[hist.length-2]);
}

events.push({ ts: ++eventSeq, runId, type: "run_started", state: "INTAKE", objective });

for (const target of ORDER) {
  if (isTerminal(current) && current !== "INTAKE") break;
  phase(PHASE_MAP[target] || "Plan");
  events.push({ ts: ++eventSeq, runId, type: "state_entered", state: target });

  let attempt = 0;
  const maxRetry = 2;
  let didPass = false;

  while (attempt <= maxRetry) {
    attempt++;
    events.push({ ts: ++eventSeq, runId, type: "worker_started", state: target, retry: attempt });

    const prompt = [
      `You are the agent for the ${target} state of the Store OS delivery harness.`,
      `Role: ${target.replace(/_/g," ").toLowerCase()}.`,
      `Objective: ${objective}`,
      `Run id: ${runId}. Write evidence under .claude/runs/${runId}/ if needed.`,
      `Spec: docs/superpowers/specs/2026-08-04-inventory-purchase-transactions-design.md`,
      `Plan: docs/superpowers/plans/2026-08-04-inventory-purchase-transactions.md`,
      target === "IMPLEMENTATION" || target === "UNIT_VERIFICATION"
        ? `Use REAL commands only: npm run typecheck, npm run test, npm run build. NO npm run verify/lint (they do NOT exist).`
        : "",
      `Return ONLY a JSON object: {agent,state,status(PASS|FAIL|BLOCKED),summary,inputsReviewed[],artifactsProduced[],commandsExecuted[{command,exitCode}],findings[{id,severity,blocking,confidence,claim,evidence[],recommendation}],risks[],assumptions[],unresolvedQuestions[],recommendedTransition}. No prose outside JSON.`,
    ].join("\n");

    let res;
    try {
      const out = await agent(prompt, { label: target, phase: PHASE_MAP[target] || "Plan" });
      res = typeof out === "string" ? JSON.parse(out) : out;
    } catch (e) {
      res = null;
    }

    const normalized = normalize(res, target);
    history[target] = (history[target] || []).concat(normalized);

    if (normalized._malformed) {
      events.push({ ts: ++eventSeq, runId, type: "worker_malformed", state: target, retry: attempt });
    } else {
      events.push({ ts: ++eventSeq, runId, type: "worker_completed", state: target, status: normalized.status, retry: attempt });
    }

    if (normalized.status === "PASS" && !(normalized.findings||[]).some((f)=>f.blocking)) {
      passed.push(target);
      revisions[target] = head;
      events.push({ ts: ++eventSeq, runId, type: "state_passed", state: target });
      didPass = true;
      current = target;
      break;
    }

    if (normalized.status === "BLOCKED") {
      events.push({ ts: ++eventSeq, runId, type: "state_blocked", state: target });
      return { runId, ok: false, status: "BLOCKED", reason: normalized.summary, events };
    }

    if (noProgress(history[target])) {
      events.push({ ts: ++eventSeq, runId, type: "state_escalated", state: target, reason: "no progress" });
      return { runId, ok: false, status: "ESCALATED", reason: `no-progress at ${target}`, events };
    }
    if (attempt > maxRetry) break;
  }

  if (!didPass) {
    events.push({ ts: ++eventSeq, runId, type: "state_failed", state: target });
    return { runId, ok: false, status: "ESCALATED", reason: `failed at ${target} after ${attempt} attempts`, events };
  }

  if (target === "RELEASE_READINESS") {
    const missing = MANDATORY.filter((m) => !passed.includes(m));
    if (missing.length) {
      return { runId, ok: false, status: "FAILED", reason: `missing mandatory: ${missing.join(", ")}`, events };
    }
  }
}

const missing = MANDATORY.filter((m) => !passed.includes(m));
events.push({ ts: ++eventSeq, runId, type: "run_ended", state: current });
return {
  runId, ok: current === "COMPLETE" && missing.length === 0, status: current,
  events, passed,
  reason: missing.length ? `missing mandatory: ${missing.join(", ")}` : undefined,
};
