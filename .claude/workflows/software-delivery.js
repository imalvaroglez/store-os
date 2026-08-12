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
// Convention: `export const meta` first, then a top-level await body. This
// runtime (a Bun-based sandbox, NOT Node/ESM) does NOT support `export default`,
// `require`, or `fs`. It exposes globals: agent/parallel/pipeline/log/phase/args/
// budget/workflow. The `args` passed via Workflow({args: {...}}) arrives as a
// STRING of JSON (verified by probe) — JSON.parse it to recover the object.
//
// Re-targeting is done by passing args.objective (REQUIRED) at invocation time:
//   Workflow({ scriptPath: ".../software-delivery.js",
//              args: { objective: "<bounded objective>", specPath?: "...", planPath?: "..." } })
// There is NO hardcoded default objective — if args.objective is missing the
// workflow hard-fails with a clear error. (Previously the objective was inlined
// as a constant, which silently ignored the passed args and caused every
// invocation to re-run the same delivery, producing false COMPLETE reports.)

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
// (breaks resume). Derive a STABLE runId from the objective so each delivery
// gets its OWN evidence directory (.claude/runs/<runId>/) — otherwise successive
// deliveries share "run_delivery/" and reviewers see stale artifacts from the
// prior objective. A 32-bit FNV-1a hash of the objective gives a short, stable,
// per-objective id.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Recover args from the runtime's JSON-string global. Hard-fail (return early)
// if objective is missing — NO silent default. This guard is load-bearing: a
// silent fallback previously made every invocation re-run a stale delivery.
let _args = {};
if (typeof args !== "undefined" && args) {
  try {
    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    // JSON.parse("null") -> null, JSON.parse("42") -> 42, etc. Normalize any
    // non-object to {} so _args.objective is always a safe property access
    // (otherwise a "null" args string throws TypeError and bypasses the
    // controlled FAILED return — verified reproducible).
    _args = parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) { _args = {}; }
}
const objective = _args.objective;
const specPath = _args.specPath || "";
const planPath = _args.planPath || "";
if (!objective || typeof objective !== "string" || !objective.trim()) {
  return {
    ok: false,
    status: "FAILED",
    reason: "Missing required args.objective. Invoke with Workflow({scriptPath, args:{objective:\"<bounded objective>\"}}). The workflow has NO default objective (a hardcoded default previously caused false COMPLETE by re-running a stale delivery).",
  };
}

const runId = "run_" + fnv1a(objective);
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
