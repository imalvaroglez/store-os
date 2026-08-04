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
// The engine validators are inlined (the workflow runtime injects agent/phase
// as globals but has no module system). src/loops/engine.cjs holds the tested
// copies; these mirror them. The test suite asserts they stay in sync.

const FSM = {
  // The canonical state order (mirrors .claude/loops/software-delivery.fsm.yaml).
  order: ["INTAKE","DISCOVERY","REQUIREMENTS_SPEC","STORY_DEFINITION","STORY_REVIEW","TEST_DESIGN","ARCHITECTURE_PRECHECK","IMPLEMENTATION_PLAN","IMPLEMENTATION","UNIT_VERIFICATION","ACCEPTANCE_VERIFICATION","CLEANUP","INDEPENDENT_CODE_REVIEW","SECURITY_HARDENING","QA_EXECUTION","ARCHITECTURE_FINAL_REVIEW","RELEASE_READINESS","COMPLETE"],
  mandatory: ["REQUIREMENTS_SPEC","STORY_DEFINITION","STORY_REVIEW","TEST_DESIGN","ARCHITECTURE_PRECHECK","IMPLEMENTATION_PLAN","IMPLEMENTATION","UNIT_VERIFICATION","ACCEPTANCE_VERIFICATION","CLEANUP","INDEPENDENT_CODE_REVIEW","SECURITY_HARDENING","QA_EXECUTION","ARCHITECTURE_FINAL_REVIEW","RELEASE_READINESS"],
  terminal: ["COMPLETE","BLOCKED","FAILED","ESCALATED","CANCELLED"],
};

function nowIso() { return new Date().toISOString(); }
function newRunId() { return "run_" + Date.now().toString(36) + "_" + Math.floor(Math.random()*1e6).toString(36); }

function isTerminal(id) { return FSM.terminal.includes(id); }
function isMandatory(id) { return FSM.mandatory.includes(id); }

function normalizeResult(res, agent, state) {
  if (!res || typeof res !== "object" || !res.status || !res.summary) {
    return { agent: (res&&res.agent)||agent||"unknown", state, status: "FAIL",
      summary: "Malformed or missing agent result — treated as failure, not empty-pass.",
      inputsReviewed: [], artifactsProduced: [], commandsExecuted: [],
      findings: [{ id: "MALFORMED_RESULT", severity: "critical", blocking: true, confidence: 1,
        claim: "Agent returned null/malformed output.", evidence: [], recommendation: "Retry; escalate if it recurs." }],
      risks: ["unreliable agent output"], assumptions: [], unresolvedQuestions: [],
      recommendedTransition: "RETRY_OR_ESCALATE", _malformed: true };
  }
  return res;
}

function detectNoProgress(history) {
  if (history.length < 2) return false;
  const last = history[history.length-1], prev = history[history.length-2];
  if (last.status === "PASS") return false;
  const sig = (r) => JSON.stringify((r&&r.artifactsProduced||[]).concat(r&&r.findings||[]));
  return sig(last) === sig(prev);
}

const AGENT_RESULT_INSTRUCTION =
  "You MUST return ONLY a JSON object matching .claude/schemas/agent-result.schema.json: " +
  "{agent,state,status(PASS|FAIL|BLOCKED|NEEDS_REVIEW),summary,inputsReviewed[],artifactsProduced[]," +
  "commandsExecuted[{command,exitCode}],findings[{id,severity,blocking,confidence,claim,evidence[],recommendation}]," +
  "risks[],assumptions[],unresolvedQuestions[],recommendedTransition}. " +
  "No prose outside the JSON. A prose-only result cannot authorize a transition.";

export default async function deliver(args) {
  const objective = args && args.objective;
  if (!objective || typeof objective !== "string" || objective.trim() === "") {
    return { ok: false, error: "args.objective (non-empty string) is required" };
  }

  const runId = newRunId();
  const events = [];
  const passed = [];
  const revisions = {};
  const history = {};
  let head = "HEAD";
  const result = { runId, startedAt: nowIso(), objective };
  events.push({ ts: nowIso(), runId, type: "run_started", state: "INTAKE", revision: head, objective });

  let current = "INTAKE";
  const phaseMap = {
    INTAKE:"Validate", DISCOVERY:"Plan", REQUIREMENTS_SPEC:"Plan", STORY_DEFINITION:"Plan",
    STORY_REVIEW:"Plan", TEST_DESIGN:"Plan", ARCHITECTURE_PRECHECK:"Plan",
    IMPLEMENTATION_PLAN:"Plan", IMPLEMENTATION:"Build", UNIT_VERIFICATION:"Build",
    ACCEPTANCE_VERIFICATION:"Build", CLEANUP:"Build", INDEPENDENT_CODE_REVIEW:"Review",
    SECURITY_HARDENING:"Review", QA_EXECUTION:"Review", ARCHITECTURE_FINAL_REVIEW:"Review",
    RELEASE_READINESS:"Release", COMPLETE:"Release",
  };

  for (const target of FSM.order) {
    if (isTerminal(current) && current !== "INTAKE") break;

    // Entry condition: the state machine order IS the transition authority.
    // (The full engine validates allowed_next from the YAML; this linear order
    // respects that because it mirrors the YAML's happy path + joins.)
    events.push({ ts: nowIso(), runId, type: "state_entered", state: target, revision: head });
    phase(phaseMap[target] || "Plan");

    // Dispatch the worker for this state.
    let attempt = 0;
    const maxRetry = 2;
    let didPass = false;

    while (attempt <= maxRetry) {
      attempt++;
      events.push({ ts: nowIso(), runId, type: "worker_started", state: target, retry: attempt });

      let res;
      try {
        const prompt = buildPrompt(target, { objective, runId, head });
        const out = await agent(prompt, { label: target, phase: phaseMap[target] || "Plan" });
        res = typeof out === "string" ? safeJson(out) : out;
      } catch (e) {
        res = null;
      }
      const normalized = normalizeResult(res, target.toLowerCase(), target);
      history[target] = (history[target] || []).concat(normalized);

      if (normalized._malformed) {
        events.push({ ts: nowIso(), runId, type: "worker_malformed", state: target, retry: attempt });
      } else {
        events.push({ ts: nowIso(), runId, type: "worker_completed", state: target, status: normalized.status, retry: attempt });
      }

      if (normalized.status === "PASS") {
        // Gate: no blocking findings.
        const blocking = (normalized.findings || []).some((f) => f.blocking);
        if (!blocking) {
          passed.push(target);
          revisions[target] = head;
          events.push({ ts: nowIso(), runId, type: "state_passed", state: target, revision: head });
          didPass = true;
          current = target;
          break;
        }
        events.push({ ts: nowIso(), runId, type: "gate_failed", state: target, reasons: ["blocking finding"] });
      }

      if (normalized.status === "BLOCKED") {
        events.push({ ts: nowIso(), runId, type: "state_blocked", state: target, reason: normalized.summary });
        return finish(result, events, "BLOCKED", `blocked at ${target}: ${normalized.summary}`);
      }

      if (detectNoProgress(history[target])) {
        events.push({ ts: nowIso(), runId, type: "state_escalated", state: target, reason: "no progress" });
        return finish(result, events, "ESCALATED", `no-progress at ${target}`);
      }
      if (attempt > maxRetry) break;
    }

    if (!didPass) {
      events.push({ ts: nowIso(), runId, type: "state_failed", state: target });
      return finish(result, events, "ESCALATED", `failed at ${target} after ${attempt} attempts`);
    }

    // RELEASE_READINESS: every mandatory state passed at the same revision.
    if (target === "RELEASE_READINESS") {
      const missing = FSM.mandatory.filter((m) => !passed.includes(m));
      if (missing.length) {
        return finish(result, events, "FAILED", `release: missing mandatory states ${missing.join(", ")}`);
      }
      const revs = new Set(FSM.mandatory.map((m) => revisions[m]).filter(Boolean));
      if (revs.size > 1) {
        return finish(result, events, "FAILED", `release: mandatory states at different revisions`);
      }
    }
  }

  // COMPLETE: all mandatory passed at one revision.
  const missing = FSM.mandatory.filter((m) => !passed.includes(m));
  if (current === "COMPLETE" && missing.length === 0) {
    events.push({ ts: nowIso(), runId, type: "run_ended", state: "COMPLETE", revision: head });
    return { ...result, ok: true, status: "COMPLETE", events, passed };
  }
  return finish(result, events, "FAILED", `did not reach COMPLETE with all mandatory gates (${missing.length} missing)`);
}

function buildPrompt(state, ctx) {
  const role = state.replace(/_/g, " ").toLowerCase();
  return [
    `You are the agent for the ${state} state of the Store OS delivery harness.`,
    `Your role: ${role}.`,
    `Objective: ${ctx.objective}`,
    `Run id: ${ctx.runId}. Write evidence under .claude/runs/${ctx.runId}/ if needed.`,
    `Reference the approved spec: docs/superpowers/specs/2026-08-04-inventory-purchase-transactions-design.md`,
    `Reference the approved plan: docs/superpowers/plans/2026-08-04-inventory-purchase-transactions.md`,
    `For IMPLEMENTATION/UNIT_VERIFICATION: use the real repo commands (npm run typecheck/test/build). ` +
      `NO npm run verify or npm run lint — they do NOT exist; never fake them.`,
    AGENT_RESULT_INSTRUCTION,
  ].join("\n");
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

function finish(result, events, status, reason) {
  events.push({ ts: nowIso(), runId: result.runId, type: "run_ended", state: status, reason });
  return { ...result, ok: false, status, reason, events };
}
