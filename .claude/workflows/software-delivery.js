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
// The objective is inlined below. To re-target, edit these three constants.
// (ponytail: a future refactor should read args.objective/specPath/planPath
//  dynamically so re-targeting needs no file edit — tracked as harness debt.)

const objective = "Separate dev and production environments so development/testing cannot touch production data, per docs/superpowers/specs/2026-08-05-environment-separation-dev-prod-design.md. Repo scope: (1) .firebaserc 'dev' alias for store-os-dev; (2) scripts/check-env.cjs build-time guard that aborts a Vercel build when VITE_VERCEL_ENV and VITE_FIREBASE_PROJECT_ID are inconsistent (preview+prod or production+non-prod), self-tested via --test, hooked into the build npm script; (3) firestore.rules email allowlist so super_admin bootstrap can't escalate an arbitrary signup if users/ is emptied; (4) docs/DEPLOYMENT.md 'Ambientes (dev vs prod)' section + runbook. The ~80% console portion (creating store-os-dev, scoped Vercel env vars, seeding Olivia, restricting+rotating the prod key) is a human runbook documented in the spec, NOT executed by agents. Drafts of items 1-2 already exist on the branch and must be audited/replaced by the FSM reviewers.";

const specPath = "docs/superpowers/specs/2026-08-05-environment-separation-dev-prod-design.md";
const planPath = ""; // no separate plan doc for this objective; the spec's scope split is the plan

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

// Deterministic runId: the workflow runtime forbids Date.now() AND Math.random()
// (breaks resume). Use a fixed counter-based id; uniqueness within a session is
// fine since the runtime tracks its own run id separately.
const runId = "run_delivery";
const events = [];
const passed = [];
const revisions = {};
const history = {};
let head = "HEAD";
let current = "INTAKE";
let eventSeq = 0; // monotonic counter — Date.now()/new Date()/Math.random() are forbidden in workflow scripts

// Extract the agent-result JSON from a response that may contain prose + embedded
// small JSON objects (findings, risks). Find the FIRST balanced {...} that has
// the required agent-result keys (status + summary + agent).
function extractJson(text) {
  if (typeof text === "object") return text;
  if (typeof text !== "string") return null;
  // Try direct parse first.
  try { return JSON.parse(text); } catch {}
  // Scan for all top-level balanced {...} blocks; return the first that has status+summary.
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") { i++; continue; }
    // Found a potential start — find its matching close.
    let depth = 0, end = -1;
    for (let j = i; j < text.length; j++) {
      if (text[j] === "{") depth++;
      if (text[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) break;
    const candidate = text.slice(i, end + 1);
    try {
      const parsed = JSON.parse(candidate);
      // Must look like an agent-result (has status + summary at minimum).
      if (parsed && typeof parsed.status === "string" && typeof parsed.summary === "string") {
        return parsed;
      }
    } catch {}
    i = end + 1; // skip to after this block and keep searching
  }
  return null;
}

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
      specPath ? `Spec: ${specPath}` : "",
      planPath ? `Plan: ${planPath}` : "",
      target === "IMPLEMENTATION" || target === "UNIT_VERIFICATION"
        ? `Use REAL commands only: npm run typecheck, npm run test, npm run build. NO npm run verify/lint (they do NOT exist).`
        : "",
      `Return ONLY a JSON object: {agent,state,status(PASS|FAIL|BLOCKED),summary,inputsReviewed[],artifactsProduced[],commandsExecuted[{command,exitCode}],findings[{id,severity,blocking,confidence,claim,evidence[],recommendation}],risks[],assumptions[],unresolvedQuestions[],recommendedTransition}. No prose outside JSON.`,
    ].join("\n");

    let res;
    try {
      const out = await agent(prompt, { label: target, phase: PHASE_MAP[target] || "Plan" });
      res = extractJson(out);
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
