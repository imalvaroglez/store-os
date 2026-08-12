---
name: store-os-delivery
description: Use for every Store OS request that builds, changes, fixes, refactors, or processes backlog. Runs the repository delivery harness so specs, tests, independent reviews, publication, CI, and Preview are verified instead of self-reported.
---

# Store OS Delivery

Use the agent for judgment and implementation. Use `npm run delivery -- ...` as the only authority for authorization, evidence, publication, and completion. Read `AGENTS.md` or `CLAUDE.md`, then `LOOPS.md`, before changing files.

The owner-approved first installation is the sole bootstrap exception. On `codex/autonomous-delivery-harness`, use `.delivery/bootstrap.json` and `npm run delivery -- verify bootstrap`; never invent a queue item or fall through to the first product spec. The exception is valid only while `origin/main` is the exact pre-harness base without `.delivery/queue.json`, and expires after that base advances.

## Start from the queue

Run `npm run delivery -- next`.

The CLI refreshes `origin/main` before authorization and fails closed when the remote base cannot be verified.

- `DRAFT_SPEC`: create a branch from current `main`, write the requested spec with `Delivery-ID` and `Delivery-Status: Pending approval`, and change only that queue entry to `awaiting-approval`. Open a draft PR, then stop. Never add `Approved-By`, approve the spec, or implement application code.
- `WAITING_SPEC_APPROVAL`, `WAITING_PR`, or `BLOCKED_DEPENDENCY`: report the explicit blocker and stop.
- `EMPTY`: report that the queue is empty.
- `READY`: create one branch from current `main`, then run `npm run delivery -- begin <id>`. Do not use worktrees.

Never skip the first actionable queue item. A green-dot backlog label is not authorization.

## Discover and plan

Keep one writer. Use read-only subagents in parallel:

1. Run `store-os-explorer` for the code map.
2. Run a second `store-os-explorer` for acceptance-test design.
3. Record both JSON results with `record discovery` and `record test-design`.
4. Produce a precise file ownership plan and record it with `record plan`.

Every result must use this common contract:

```json
{
  "status": "PASS",
  "summary": "Concrete conclusion",
  "evidence": ["path:line or reproducible command"],
  "findings": []
}
```

Explorer results add `worker: {"id":"actual-agent-id","profile":"store-os-explorer","lens":"discovery|test-design"}`. A plan also includes nonempty `ownedPaths`. Reviews add `reviewer: {"id":"actual-agent-id","profile":"store-os-reviewer","lens":"standards-spec|security-privacy|qa-evidence|adversarial"}` and use findings shaped as `{"id":"S1","blocking":true,"claim":"...","evidence":["..."]}`. The three review IDs and adversarial ID must be distinct. `SubagentStop` persists a receipt tied to the real agent ID, result hash, and SHA; `record` rejects hand-written identities. Never invent evidence or command results. Never mutate `.delivery/runs` directly; only the lifecycle hook and delivery CLI may write evidence.

## Implement with one writer

Implement the smallest spec-complete change. Run `npm run delivery -- verify quick` after each logical slice and return failures to the same writer. Do not edit files owned by an open PR; the harness rejects overlap.

Before final review:

1. Add `.delivery/completed/<id>.json` containing `id`, `specPath`, and `deliveryStatus: "implemented"`.
2. Create a candidate commit so the tree is clean and the SHA is fixed.
3. Run `npm run delivery -- verify final`.

Any code change after this point invalidates final verification and every review.

## Review the exact candidate SHA

Run three read-only `store-os-reviewer` instances in parallel against the same SHA:

- Standards/spec, using `store-os-review` for Store OS design-system, Spanish UI, mobile-first, and no-bypass checks.
- Security/privacy, covering multistore isolation, Firebase rules/data access, privacy, production safety, and zero cost.
- QA/evidence, covering acceptance criteria, regression risk, real UI behavior, and test evidence.

Record them as `review-standards`, `review-security`, and `review-qa`.

Send every blocking finding to a separate adversarial reviewer. Record each verdict as `confirmed`, `uncertain`, or `refuted`. Confirmed or uncertain findings require a fix. Refutations require reproducible evidence. After a fix, commit and repeat final verification plus all three reviews. After more than two correction rounds the harness enters `BLOCKED_HUMAN`.

## Publish and verify remote state

Run `npm run delivery -- gate publish` before push or draft-PR creation. The hooks also enforce this gate.

Open only a draft PR. Its body must include:

- `Delivery-ID: <id>`
- spec path
- candidate SHA
- every command executed by `verify final`

Never merge, push to `main`, deploy production, read production data, or run a production mutation. Production reads require explicit human approval; any `--apply` requires a separate second approval.

Wait until CI and Preview are green, then run `npm run delivery -- remote <pr-number>`. This command checks GitHub state and executes declared `previewChecks` with a real browser. Private flows use Firebase Emulator only.
The Preview comment must come from GitHub Actions, identify the candidate SHA, and use an HTTPS `*.vercel.app` URL. Every queued item must declare at least one check. The publish gate refreshes `origin/main` and invalidates work that was concurrently completed, frozen, changed, or dependency-blocked.

Return to `main` and run `next` only after `REMOTE_GREEN`. A second open PR is allowed only when independent and file-disjoint.

## Finish truthfully

The only successful item result is:

`DRAFT PR GREEN — READY FOR HUMAN REVIEW`

Otherwise report the exact harness state and blocker. Never say merged, production-ready, or complete based on agent judgment alone.
