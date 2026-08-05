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

const objective = "Build a one-command dev seed script (scripts/seed-dev.cjs) that populates the isolated store-os-dev Firebase project with realistic test data so the developer can work against a populated dev environment without touching production, per docs/superpowers/specs/2026-08-05-dev-seed-script-design.md. Reuse src/lib/seed.ts buildSeedState() to construct the Olivia jewelry store (slug 'olivia', same as prod — safe because projects are separate) with its categories, ~5 products, customers, and orders, writing to dev Firestore via the app's write paths (saveEntity/setDoc) with membership fields (ownerUid/memberUids) set to the admin uid. Claim the slug and write public projections so /catalogo/olivia works on the Preview. Upload 1-2 generated sample JPEGs to dev Storage and link them on a product (validates the dev Storage + IAM grant). The script MUST be dev-only: it hardcodes the dev Firebase config and aborts unless projectId === 'store-os-dev' (guard like check-env.cjs). Credentials (admin@store.os password) come from a gitignored .env.seed-dev the human creates locally; the script refuses to run without it and prints instructions. Idempotent (fixed ids from buildSeedState overwrite cleanly on re-run).";

const specPath = "docs/superpowers/specs/2026-08-05-dev-seed-script-design.md";
const planPath = "";

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
  // Scan for all top-level balanced {...} blocks; return the first that has
  // status+summary. CRITICAL: the brace counter must IGNORE braces inside JSON
  // strings (e.g. "claim":"...{storeId}...") — a naive counter desyncs on those
  // and fails to find the real object close, yielding a false "malformed".
  const scan = (input) => {
    let i = 0;
    while (i < input.length) {
      if (input[i] !== "{") { i++; continue; }
      // Found a potential start — find its matching close, string-aware.
      let depth = 0, end = -1, inStr = false, escape = false;
      for (let j = i; j < input.length; j++) {
        const c = input[j];
        if (escape) { escape = false; continue; }
        if (c === "\\") { escape = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "{") depth++;
        if (c === "}") { depth--; if (depth === 0) { end = j; break; } }
      }
      if (end < 0) break;
      const candidate = input.slice(i, end + 1);
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
  };

  let result = scan(text);
  if (result) return result;

  // Fallback: the GLM gateway sometimes emits enum-like string values WITHOUT
  // quotes (e.g. "confidence":high, "severity":medium, "status":PASS). Quote
  // those specific keys' bareword values and retry once. Conservative — only
  // matches the known keys followed by a bareword token.
  // ponytail: targeted regex fixup, not a general JSON repair. If the gateway
  // invents new malformations, this won't catch them — but it clears the known
  // recurring one without a real parser dependency.
  const BAREWORD_KEYS = ["confidence", "severity", "status", "blocking"];
  let repaired = text;
  for (const key of BAREWORD_KEYS) {
    // "key":<bareword>  →  "key":"<bareword>"
    repaired = repaired.replace(
      new RegExp(`"(${key})"\\s*:\\s*([A-Za-z_][A-Za-z0-9_]*)`, "g"),
      `"$1":"$2"`
    );
  }
  if (repaired !== text) {
    result = scan(repaired);
    if (result) return result;
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
      `Re-read the ACTUAL current repo state (the working tree may have changed since prior attempts of this state — do not trust cached assumptions; verify against the files as they are now).`,
      `CRITICAL CONSISTENCY RULE (the FSM rejects self-contradictory results): status MUST be FAIL if ANY finding has blocking=true. Equivalently: NEVER set status:"PASS" while also emitting a finding with blocking:true. If the work is incomplete or has an unresolved blocker, status is FAIL or BLOCKED, never PASS. A PASS with zero blocking findings is the only PASS.`,
      `Return ONLY a valid JSON object. ALL string values MUST be double-quoted — including enum-like fields. Example findings entry (note the quotes around severity/confidence/status values): {"id":"F1","severity":"high","blocking":true,"confidence":"high","claim":"...","evidence":["..."],"recommendation":"..."}. Common malformations that break parsing: unquoted values like "confidence":high (must be "high"), trailing commas, or single quotes. Emit NONE of those.`,
      `Schema: {agent,state,status(PASS|FAIL|BLOCKED),summary,inputsReviewed[],artifactsProduced[],commandsExecuted[{command,exitCode}],findings[{id,severity,blocking,confidence,claim,evidence[],recommendation}],risks[],assumptions[],unresolvedQuestions[],recommendedTransition}. No prose outside the JSON.`,
      `[attempt ${attempt}]`,
    ].join("\n");

    let res;
    try {
      const out = await agent(prompt, { label: target, phase: PHASE_MAP[target] || "Plan", effort: "xhigh" });
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
