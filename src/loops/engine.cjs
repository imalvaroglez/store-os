// Runtime validation for the delivery harness. Pure functions, no I/O, used by
// the workflow, the simulator, and the vitest suite. This is the layer that
// makes "fail closed" enforceable: an invalid FSM, an undeclared transition, an
// unsatisfied gate, or a malformed agent result can NEVER reach COMPLETE.
//
// ponytail: hand-rolled validators. ajv would add a dep for ~200 lines of
// checks we can express directly against the schemas above. Swap if the schemas
// grow beyond what's readable here.
//
// Exposed as plain CommonJS so it loads from .claude/workflows/*.js (no Vite)
// AND from src/loops/*.test.ts (vitest). The test files import this directly.

/**
 * @typedef {Object} FsmState
 * @property {string} id
 * @property {string} agent
 * @property {boolean} read_only
 * @property {boolean} worktree
 * @property {string} risk
 * @property {string[]} inputs
 * @property {string[]} outputs
 * @property {string[]} entry_conditions
 * @property {string[]} exit_conditions
 * @property {Array<{id:string,cmd:string,must_pass:boolean}>} deterministic_commands
 * @property {{required:boolean, quorum?:number, agent?:string, independent?:boolean}} review
 * @property {string[]} allowed_next
 * @property {number} retry_limit
 * @property {number} timeout_ms
 * @property {string} on_failure
 * @property {string} on_escalation
 * @property {string[]} evidence_required
 */

/** Collect every structural violation in an FSM object. Returns [] if valid. */
function validateFsm(fsm) {
  const errs = [];
  if (!fsm || typeof fsm !== "object") return ["fsm is not an object"];
  if (!Array.isArray(fsm.states)) return ["fsm.states is not an array"];

  const ids = new Set();
  const byId = new Map();
  fsm.states.forEach((s, i) => {
    if (!s || typeof s !== "object") return errs.push(`states[${i}] is not an object`);
    if (!s.id) return errs.push(`states[${i}] missing id`);
    if (!/^[A-Z][A-Z0-9_]*$/.test(s.id)) return errs.push(`state id "${s.id}" must be UPPER_SNAKE`);
    if (ids.has(s.id)) return errs.push(`duplicate state id "${s.id}"`);
    ids.add(s.id);
    byId.set(s.id, s);
  });

  // mandatory_states must exist.
  for (const m of fsm.mandatory_states || []) {
    if (!ids.has(m)) errs.push(`mandatory_state "${m}" not declared in states`);
  }
  // terminal_states must exist and have no allowed_next.
  for (const t of fsm.terminal_states || []) {
    if (!ids.has(t)) errs.push(`terminal_state "${t}" not declared`);
    const s = byId.get(t);
    if (s && Array.isArray(s.allowed_next) && s.allowed_next.length > 0) {
      errs.push(`terminal state "${t}" must have empty allowed_next`);
    }
  }
  // every allowed_next / on_failure / on_escalation must reference a real state.
  for (const s of fsm.states) {
    for (const n of s.allowed_next || []) if (!ids.has(n)) errs.push(`state "${s.id}" allowed_next "${n}" does not exist`);
    if (s.on_failure && !ids.has(s.on_failure)) errs.push(`state "${s.id}" on_failure "${s.on_failure}" does not exist`);
    if (s.on_escalation && !ids.has(s.on_escalation)) errs.push(`state "${s.id}" on_escalation "${s.on_escalation}" does not exist`);
  }
  // A state with a review gate must name a reviewer agent other than itself.
  for (const s of fsm.states) {
    if (s.review && s.review.required && s.review.agent && s.review.agent === s.agent) {
      errs.push(`state "${s.id}" cannot self-review (review.agent === agent)`);
    }
  }
  return errs;
}

/** True only if `to` is a permitted transition from `from` per the FSM. */
function isAllowedTransition(fsm, from, to) {
  const s = (fsm.states || []).find((x) => x.id === from);
  if (!s) return false;
  if ((s.allowed_next || []).includes(to)) return true;
  // Failure/escalation targets are also permitted transitions (to terminal/handoff).
  if (s.on_failure === to || s.on_escalation === to) return true;
  return false;
}

/** True if `stateId` is terminal (no further transitions). */
function isTerminal(fsm, stateId) {
  return (fsm.terminal_states || []).includes(stateId);
}

/** True if `stateId` is mandatory for completion. */
function isMandatory(fsm, stateId) {
  return (fsm.mandatory_states || []).includes(stateId);
}

/** Validate a worker result object against the agent-result contract. */
function validateAgentResult(res) {
  const errs = [];
  if (!res || typeof res !== "object") return ["result is not an object"];
  const REQUIRED = ["agent", "state", "status", "summary", "inputsReviewed", "artifactsProduced", "commandsExecuted", "findings", "recommendedTransition"];
  for (const k of REQUIRED) if (!(k in res)) errs.push(`missing "${k}"`);
  if (errs.length) return errs;
  if (!["PASS", "FAIL", "BLOCKED", "NEEDS_REVIEW"].includes(res.status)) errs.push(`bad status "${res.status}"`);
  if (typeof res.summary !== "string" || res.summary.trim() === "") errs.push("summary must be non-empty");
  if (!Array.isArray(res.commandsExecuted)) errs.push("commandsExecuted must be an array");
  else for (const c of res.commandsExecuted) {
    if (!c || typeof c.command !== "string" || typeof c.exitCode !== "number") errs.push("each command needs {command, exitCode}");
  }
  if (!Array.isArray(res.findings)) errs.push("findings must be an array");
  else for (const f of res.findings) {
    if (!f || typeof f !== "object") { errs.push("finding not an object"); continue; }
    if (typeof f.blocking !== "boolean") errs.push(`finding "${f.id}" blocking must be boolean`);
    if (typeof f.confidence !== "number" || f.confidence < 0 || f.confidence > 1) errs.push(`finding "${f.id}" confidence out of [0,1]`);
    if (!["critical", "high", "medium", "low", "info"].includes(f.severity)) errs.push(`finding "${f.id}" bad severity`);
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(res.recommendedTransition)) errs.push(`bad recommendedTransition "${res.recommendedTransition}"`);
  return errs;
}

/** Treat null/undefined/malformed as failure (never empty-pass). Returns a normalized result. */
function normalizeResult(res, fallbackAgent, stateId) {
  const errs = validateAgentResult(res);
  if (errs.length || !res) {
    return {
      agent: (res && res.agent) || fallbackAgent || "unknown",
      state: stateId,
      status: "FAIL",
      summary: "Malformed or missing agent result — treated as failure, not empty-pass.",
      inputsReviewed: [], artifactsProduced: [], commandsExecuted: [],
      findings: [{ id: "MALFORMED_RESULT", severity: "critical", blocking: true, confidence: 1, claim: "Agent returned null/malformed output.", evidence: errs.slice(0, 5), recommendation: "Retry; escalate if it recurs." }],
      risks: ["unreliable agent output"], assumptions: [], unresolvedQuestions: [],
      recommendedTransition: "RETRY_OR_ESCALATE",
      _malformed: true,
    };
  }
  return res;
}

/**
 * Gate evaluation for a state. A state PASSES its gate when:
 *  - status === PASS, AND
 *  - no finding is blocking, AND
 *  - if review.required, quorum independent PASS decisions were collected, AND
 *  - every deterministic must_pass command exited 0 (when the state ran any).
 * Returns {passed, reasons}.
 */
function evaluateGate(fsm, stateId, results, commandLog) {
  const reasons = [];
  const state = (fsm.states || []).find((s) => s.id === stateId);
  if (!state) return { passed: false, reasons: [`unknown state "${stateId}"`] };

  const valid = results.filter((r) => r && r.status === "PASS" && !r._malformed);
  // blocking findings sink the gate regardless of count.
  for (const r of results) {
    for (const f of (r && r.findings) || []) {
      if (f.blocking) reasons.push(`blocking finding "${f.id}" from ${r.agent}`);
    }
  }
  if (reasons.length) return { passed: false, reasons };

  if (state.review && state.review.required) {
    const quorum = state.review.quorum || 1;
    // independence: count distinct agents (an author cannot be its sole approver).
    const approvers = new Set(valid.map((r) => r.agent));
    // the state's own producing agent may NOT count toward review quorum.
    if (state.agent) approvers.delete(state.agent);
    if (approvers.size < quorum) {
      reasons.push(`review quorum ${quorum} not met (got ${approvers.size} independent approvals)`);
    }
    // low-confidence approval does not satisfy a mandatory gate.
    for (const r of valid) {
      for (const f of r.findings || []) {
        if (f.severity === "info" || f.severity === "low") continue;
        if (f.confidence < 0.5 && !f.blocking) reasons.push(`low-confidence finding "${f.id}" (${f.confidence})`);
      }
    }
  }
  // deterministic commands: any must_pass that ran non-zero fails closed.
  for (const cmd of state.deterministic_commands || []) {
    if (!cmd.must_pass) continue;
    const ran = (commandLog || []).filter((c) => c.stateId === stateId && c.commandId === cmd.id);
    if (ran.length === 0) continue; // not yet run
    if (!ran.every((c) => c.exitCode === 0)) reasons.push(`command "${cmd.id}" failed (non-zero exit)`);
  }
  return { passed: reasons.length === 0, reasons };
}

/** RELEASE_READINESS: every mandatory state must have passed at the SAME revision. */
function releaseReady(fsm, passedStates, revisions) {
  const reasons = [];
  for (const m of fsm.mandatory_states || []) {
    if (!passedStates.includes(m)) reasons.push(`mandatory state "${m}" did not pass`);
  }
  // same-revision attestation: every passed mandatory state's recorded revision must match.
  const distinct = new Set((fsm.mandatory_states || []).map((m) => revisions[m]).filter(Boolean));
  if (distinct.size > 1) reasons.push(`mandatory states passed at different revisions: ${[...distinct].join(", ")}`);
  return { passed: reasons.length === 0, reasons };
}

/** Detect two consecutive attempts with no measurable progress. */
function detectNoProgress(history) {
  if (history.length < 2) return false;
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  // "progress" = a different (larger) outputs/artifacts signature or a PASS.
  if (last.status === "PASS") return false;
  const sig = (r) => JSON.stringify((r && r.artifactsProduced || []).concat(r && r.findings || []));
  return sig(last) === sig(prev);
}

/** File-ownership conflict: two editors touching overlapping paths. */
function detectOwnershipConflict(owned, claimed) {
  // owned: {agentId: string[]}, claimed: {agentId: string[]}
  const overlaps = [];
  const all = { ...owned, ...claimed };
  const agents = Object.keys(all);
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = all[agents[i]], b = all[agents[j]];
      const hit = a.filter((p) => b.some((q) => pathsOverlap(p, q)));
      if (hit.length) overlaps.push({ a: agents[i], b: agents[j], paths: hit });
    }
  }
  return overlaps;
}
function pathsOverlap(p, q) {
  // exact match, or one is a directory prefix of the other.
  if (p === q) return true;
  return p.startsWith(q + "/") || q.startsWith(p + "/");
}

module.exports = {
  validateFsm, isAllowedTransition, isTerminal, isMandatory,
  validateAgentResult, normalizeResult, evaluateGate, releaseReady,
  detectNoProgress, detectOwnershipConflict, pathsOverlap,
};
