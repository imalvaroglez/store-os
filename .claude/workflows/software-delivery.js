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
//
// Invoke via the Workflow tool:
//   Workflow({ scriptPath: ".claude/workflows/software-delivery.js", args: { objective: "..." } })
//
// This workflow is the EXECUTOR of .claude/loops/software-delivery.fsm.yaml. The
// YAML is canonical; this JS never invents transitions. Every state change is
// validated by src/loops/engine.cjs (validateFsm / isAllowedTransition /
// evaluateGate / normalizeResult). null/malformed agent results are failures,
// never empty-pass. The GLM gateway makes subagent output occasionally
// unreliable, so every agent() result is schema-validated before use.

const ENGINE = require("../../src/loops/engine.cjs");
const {
  validateFsm, isAllowedTransition, isTerminal, isMandatory,
  normalizeResult, evaluateGate, releaseReady, detectNoProgress,
} = ENGINE;

const AGENT_RESULT_SCHEMA = "You MUST return ONLY a JSON object matching .claude/schemas/agent-result.schema.json: {agent,state,status(PASS|FAIL|BLOCKED|NEEDS_REVIEW),summary,inputsReviewed[],artifactsProduced[],commandsExecuted[{command,exitCode}],findings[{id,severity,blocking,confidence,claim,evidence[],recommendation}],risks[],assumptions[],unresolvedQuestions[],recommendedTransition}. No prose outside the JSON. A prose-only result cannot authorize a transition.";

// ───────────────────────── helpers ─────────────────────────

function loadFsm() {
  // The workflow runtime has no fs; the FSM is inlined here as a JSON constant
  // sourced from .claude/loops/software-delivery.fsm.yaml (kept in sync by the
  // vitest test test("fsm inline matches yaml")). ponytail: dual-source is
  // acceptable because the test asserts equality; a YAML parser dep is YAGNI.
  return FSM; // defined at bottom
}

function nowIso() { return new Date().toISOString(); }

// Deterministic run id from time + counter (Date.now is available at workflow
// runtime; the engine's pure functions avoid it, but this orchestration layer may).
function newRunId() {
  return "run_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36);
}

// Persist an event to the run journal. In the workflow runtime we cannot touch
// the filesystem directly; we collect events and emit them as the workflow's
// return value so the host writes them. (A hook can also mirror to disk.)
function journal(events, ev) { events.push({ ts: nowIso(), ...ev }); }

// ───────────────────────── workflow body ─────────────────────────

export default async function deliver(args) {
  const objective = args && args.objective;
  if (!objective || typeof objective !== "string" || objective.trim() === "") {
    return { ok: false, error: "args.objective (non-empty string) is required" };
  }

  // 1. Validate the FSM before anything else.
  const fsm = loadFsm();
  const fsmErrs = validateFsm(fsm);
  if (fsmErrs.length) {
    return { ok: false, error: "Invalid FSM; refusing to spawn workers.", fsmErrors: fsmErrs };
  }

  // 2–4. Run id + evidence dir (logical) + record HEAD revision.
  const runId = newRunId();
  const events = [];
  const passed = [];                 // mandatory states that passed
  const revisions = {};              // state -> sha at pass
  const evidence = {};               // state -> result objects
  const history = {};                // state -> [results...] for no-progress
  let head = "HEAD";                 // symbolic; qa-executor records the real sha
  journal(events, { runId, type: "run_started", state: "INTAKE", revision: head, objective });

  // Order derived from the FSM's allowed_next, respecting parallel-group joins.
  // The engine enforces isAllowedTransition on each step regardless.
  const order = [
    "INTAKE", "DISCOVERY", "REQUIREMENTS_SPEC", "STORY_DEFINITION",
    "STORY_REVIEW", "TEST_DESIGN", "ARCHITECTURE_PRECHECK",
    "IMPLEMENTATION_PLAN", "IMPLEMENTATION", "UNIT_VERIFICATION",
    "ACCEPTANCE_VERIFICATION", "CLEANUP", "INDEPENDENT_CODE_REVIEW",
    "SECURITY_HARDENING", "QA_EXECUTION", "ARCHITECTURE_FINAL_REVIEW",
    "RELEASE_READINESS", "COMPLETE",
  ];

  let current = "INTAKE";
  const result = { runId, fsmVersion: fsm.fsm_version, startedAt: nowIso(), objective };

  for (const target of order) {
    if (isTerminal(fsm, current) && current !== "INTAKE") break;
    // 6. Entry condition: target must be an allowed transition from current.
    if (current !== target && !isAllowedTransition(fsm, current, target)) {
      journal(events, { runId, type: "transition_rejected", state: current, reason: `undeclared transition ${current} -> ${target}` });
      // 7. Prevent unauthorized transitions → fail the run.
      return { ...result, ok: false, status: "FAILED", error: `undeclared transition ${current} -> ${target}`, events };
    }

    const state = fsm.states.find((s) => s.id === target);
    journal(events, { runId, type: "state_entered", state: target, revision: head });

    // 9–14. Dispatch worker(s) with bounded retry + no-progress detection.
    let res = null;
    let attempt = 0;
    const attempts = [];
    while (attempt <= state.retry_limit) {
      attempt++;
      journal(events, { runId, type: "worker_started", state: target, agent: state.agent, retry: attempt });
      res = await runWorker(state, { objective, runId, head, evidence });
      // 10/19. Validate the structured response; null/malformed => failure.
      const normalized = normalizeResult(res, state.agent, target);
      attempts.push(normalized);
      history[target] = (history[target] || []).concat(normalized);
      if (normalized._malformed) {
        journal(events, { runId, type: "worker_malformed", state: target, agent: state.agent, retry: attempt });
      } else {
        journal(events, { runId, type: "worker_completed", state: target, agent: state.agent, status: normalized.status, retry: attempt });
      }

      // If the worker itself ran deterministic commands, fold their exit codes
      // into the gate evaluation (commandsExecuted -> commandLog shape).
      const commandLog = (normalized.commandsExecuted || []).map((c) => ({
        stateId: target, commandId: inferCommandId(state, c.command),
        exitCode: c.exitCode, revision: c.revision || head,
      }));

      if (normalized.status === "PASS") {
        // 8/19. Gate check (review quorum, blocking findings, commands).
        const gate = evaluateGate(fsm, target, [normalized], commandLog);
        if (gate.passed) {
          evidence[target] = normalized;
          passed.push(target);
          revisions[target] = head;
          journal(events, { runId, type: "state_passed", state: target, revision: head });
          current = target;
          break;
        }
        // Gate not satisfied despite PASS (e.g., missing quorum) -> needs review.
        journal(events, { runId, type: "gate_failed", state: target, reasons: gate.reasons });
      }

      // 14. Two consecutive attempts without measurable progress -> escalate.
      if (detectNoProgress(history[target])) {
        journal(events, { runId, type: "state_escalated", state: target, reason: "no progress" });
        return terminate(result, events, "ESCALATED", `no-progress at ${target}`);
      }
      // 13. Stop retrying after the configured bound.
      if (attempt > state.retry_limit) break;
    }

    const last = attempts[attempts.length - 1];
    if (!last || last.status !== "PASS" || !passed.includes(target)) {
      // 15–16. Failure handling per the state's on_failure / on_escalation.
      const failure = state.on_failure;
      if (["BLOCKED", "FAILED", "ESCALATED", "HUMAN"].includes(failure)) {
        journal(events, { runId, type: "state_failed", state: target, transition: failure });
        return terminate(result, events, failure === "HUMAN" ? "ESCALATED" : failure, `failed at ${target}`);
      }
      // recoverable: loop back into the failure target on the next iteration
      current = failure;
      journal(events, { runId, type: "state_failed", state: target, transition: failure });
    }

    if (target === "RELEASE_READINESS") {
      // 19. RELEASE_READINESS: every mandatory gate at the SAME revision.
      const rr = releaseReady(fsm, passed, revisions);
      if (!rr.passed) {
        journal(events, { runId, type: "gate_failed", state: "RELEASE_READINESS", reasons: rr.reasons });
        return terminate(result, events, "FAILED", "release readiness unsatisfied: " + rr.reasons.join("; "));
      }
    }
  }

  // COMPLETE only if reached and every mandatory gate passed at one revision.
  const rr = releaseReady(fsm, passed, revisions);
  if (current === "COMPLETE" && rr.passed) {
    journal(events, { runId, type: "run_ended", state: "COMPLETE", revision: head });
    return { ...result, ok: true, status: "COMPLETE", events, evidence };
  }
  return terminate(result, events, "FAILED", "did not reach COMPLETE with all mandatory gates");
}

// Dispatch a single worker via the dynamic-workflow agent() primitive.
// Minimal context is passed; the agent reads the repo itself.
async function runWorker(state, ctx) {
  const prompt = [
    `You are the "${state.agent}" agent in the Store OS delivery harness.`,
    `State: ${state.id}. Purpose: ${state.purpose}`,
    `Run id: ${ctx.runId}. Write evidence ONLY under .claude/runs/${ctx.runId}/.`,
    `Objective: ${ctx.objective}`,
    state.review && state.review.required ? `This state requires independent review (quorum ${state.review.quorum || 1}).` : "",
    state.deterministic_commands && state.deterministic_commands.length
      ? `Deterministic commands for this state: ${state.deterministic_commands.map((c) => c.cmd + (c.must_pass ? " (must pass)" : " (contextual)")).join("; ")}. Run them and report REAL exit codes. Do NOT invent success; do NOT run npm run verify/lint (they do not exist).`
      : "",
    AGENT_RESULT_SCHEMA,
  ].join("\n");
  try {
    const out = await agent(prompt, { label: `${state.agent}:${state.id}`, phase: phaseFor(state.id) });
    // agent() returns a string when no schema is forced; parse to object.
    if (out && typeof out === "object") return out;
    if (typeof out === "string") return safeJsonParse(out);
    return null;
  } catch (e) {
    return null; // treated as failure by normalizeResult
  }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
function inferCommandId(state, cmd) {
  const m = (state.deterministic_commands || []).find((c) => c.cmd === cmd);
  return m ? m.id : cmd;
}
function phaseFor(stateId) {
  const map = {
    INTAKE: "Validate", DISCOVERY: "Plan", REQUIREMENTS_SPEC: "Plan", STORY_DEFINITION: "Plan",
    STORY_REVIEW: "Plan", TEST_DESIGN: "Plan", ARCHITECTURE_PRECHECK: "Plan",
    IMPLEMENTATION_PLAN: "Plan", IMPLEMENTATION: "Build", UNIT_VERIFICATION: "Build",
    ACCEPTANCE_VERIFICATION: "Build", CLEANUP: "Build", INDEPENDENT_CODE_REVIEW: "Review",
    SECURITY_HARDENING: "Review", QA_EXECUTION: "Review", ARCHITECTURE_FINAL_REVIEW: "Review",
    RELEASE_READINESS: "Release", COMPLETE: "Release",
  };
  return map[stateId] || "Plan";
}
function terminate(result, events, status, reason) {
  events.push({ ts: nowIso(), runId: result.runId, type: "run_ended", state: status, reason });
  return { ...result, ok: false, status, reason, events };
}

// ───────────────────────── FSM (mirror of the YAML) ─────────────────────────
// Kept as a JS object so the workflow runtime (no YAML parser) can use it.
// test("fsm inline matches yaml") asserts this stays in sync with the .fsm.yaml.
const FSM = require("./software-delivery.fsm.json");
