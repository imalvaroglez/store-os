# ADR 0002 — Remove the Delivery Harness Ceremony

- **Status:** Accepted
- **Date:** 2026-08-29
- **Deciders:** Repository owner (Álvaro González)
- **Supersedes:** [ADR 0001](0001-multi-agent-delivery-harness.md)

## Context

ADR 0001 installed an executable delivery harness: a gating queue, spec-approval PRs, SubagentStop receipts binding reviewer identity, three mandatory reviewer lenses, and publish/stop gates. It delivered safely for two weeks (public catalog, harness hardening), but its ceremony cost kept growing: up to **three PRs before any user-visible change** (queue alta → spec → code), each waiting on CI/Preview and a human merge, plus a hard coupling that only sessions launched from this repository could produce the receipts the CLI demanded.

The owner judged the ceremony no longer worth its safety: the durable protection (tests, design-system gate, rules/e2e suites, CI, human-only merge, environment isolation) does not depend on the harness.

## Decision

Remove the harness as a gate for code changes. The flow is:

**one branch from `main` → tests first (red → green) → `typecheck && test && build` green → one draft PR (spec inside the same PR when one is written) → CI + Preview → human merges.**

Deleted: `.delivery/` (queue, bootstrap, completed markers, runs), `scripts/delivery-harness.cjs`, `scripts/delivery-hook.cjs`, the `store-os-delivery` skills (Claude + Codex), the SubagentStop hook wiring, `npm run delivery`, and the CI `delivery-config` job. The queue survives as inert data at `docs/backlog.json`; the ADR-0001 autonomy limits survive in `LOOPS.md`.

## Consequences

- One PR per change. Agents may branch, commit, push branches, and open draft PRs autonomously; merge, `main`, production, and production data remain human-only.
- Reviews become read-only subagent passes (standards/security/QA) whose findings the author resolves — no receipts, no gates.
- The two-session constraint (implementation only from a repository-root session, for hook receipts) disappears.
- Historical harness artifacts (receipts, run evidence) are gone from the working tree but recoverable from git history.
