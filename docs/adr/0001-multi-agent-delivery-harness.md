# ADR 0001 — Multi-Agent Software Delivery Harness

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** Principal architect (Claude), repository owner (Álvaro González)

## Context

Store OS is delivered largely through Claude Code agents. Informal,
turn-by-turn orchestration works for small changes but cannot guarantee the
safety properties that matter as the product grows: that a change never reaches
"done" with an unsatisfied gate, that an artifact's author never sole-approves
it, that retries are bounded, and that a stale result cannot approve a newer
revision. We need a harness whose correctness is enforced by a validated
finite-state machine, with persisted evidence and independent verification.

## Decision

Adopt a four-layer, spec-driven delivery harness:

1. **`LOOPS.md`** — normative human-readable policy.
2. **`.claude/loops/software-delivery.fsm.yaml`** — canonical machine-readable
   FSM (the source of truth for transitions), validated by
   `.claude/schemas/fsm.schema.json` and enforced by `src/loops/engine.cjs`.
3. **`.claude/agents/*.md`** — specialized workers (read-only analyzers/reviewers;
   worktree-isolated editors).
4. **`.claude/workflows/software-delivery.js`** (executes the FSM) and
   `simulate-software-delivery.js` (Monte-Carlo chaos-tests it).

The engine is pure functions (no I/O) and unit-tested in
`src/loops/engine.test.ts`; the supreme invariant — "never COMPLETE with an
unsatisfied mandatory gate" — is asserted both in the simulator and in tests.

## Alternatives considered

- **Scripts + subagents + hooks fallback** (no dynamic workflow): rejected —
  dynamic Workflows are available in this environment and have run here before;
  a deterministic workflow gives stronger transition guarantees than ad-hoc
  orchestration. (Hooks remain at zero; deterministic protection lives in the
  engine + FSM, not in event hooks.)
- **A single general-purpose agent end-to-end**: rejected — violates separation
  of duties (author cannot be sole reviewer) and has no enforceable gates.
- **ajv schema validation lib**: deferred (ponytail) — the schemas are small
  enough to validate with ~150 lines of hand-rolled checks; revisit if they grow.

## Consequences

- **Positive:** transitions are machine-checked; completion implies a
  same-revision attestation; retries are bounded; security violations never
  auto-retry; the simulator proves (by exhaustion over seeded runs) that no
  false-success path exists.
- **Negative:** two sources for the FSM (YAML + JSON mirror) — mitigated by a
  test asserting equality; subagent output is occasionally malformed on the
  configured gateway — mitigated by treating malformed results as failure
  (fail-closed), never empty-pass.
- **Neutral:** the human Oversight Loop (`docs/LOOPS.md`) is unchanged; this
  harness automates the inner loops but escalates irreversible/human-judgment
  decisions rather than removing them.
