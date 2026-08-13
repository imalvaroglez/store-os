# Store OS Delivery Policy

This file is the human-readable policy for the delivery harness. The executable authority is `scripts/delivery-harness.cjs`; when prose and a CLI result differ, the CLI fails closed and wins. `docs/LOOPS.md` remains background guidance, not a second state machine.

## One-time bootstrap

The first PR that installs this harness is infrastructure, not a product queue item. It uses `Delivery-ID: delivery-harness-bootstrap` and the owner-approved `.delivery/bootstrap.json`. `verify bootstrap`, `gate publish`, `remote`, and `gate stop` accept it only while `origin/main` is exactly the approved pre-harness SHA and does not contain `.delivery/queue.json`. The candidate branch, changed-file set, clean SHA, real commands, draft PR, CI, Preview, and browser check must all match the closed bootstrap contract. The exception disables itself as soon as `main` advances or contains the queue; every later change uses the normal queue.

## Required entry point

Every request to build, change, fix, refactor, or process backlog MUST load `store-os-delivery`:

- Codex: `.agents/skills/store-os-delivery/SKILL.md`
- Claude Code: `.claude/skills/store-os-delivery/SKILL.md`

Start with `npm run delivery -- next`. Never select a lower-priority item because the first item is inconvenient or blocked.
Queue authorization commands fetch `origin/main` first and fail closed if it cannot be refreshed.

## Authorization

Code implementation is authorized only when all of these are true:

1. The queue item is `queued`.
2. Its spec exists in `main` with matching `Delivery-ID`, `Delivery-Status: Approved`, and a nonempty `Approved-By`.
3. `.delivery/completed/<id>.json` is not already in `main`.
4. No open PR already carries that `Delivery-ID`.
5. Every dependency is completed.

A backlog `ready` label is not authorization.

For `needs-spec`, the only permitted change is the new spec plus that queue entry changing to `awaiting-approval`. The spec uses `Delivery-Status: Pending approval`. The agent opens a draft PR and stops. The agent never writes `Approved-By`, approves its own spec, or implements code in that PR.

## One delivery, one writer

Each implementation uses one branch created from current `main`, one item per draft PR, and one writer. V1 does not use worktrees or parallel editors.

Read-only exploration and review may run in parallel. Before implementation, two `store-os-explorer` runs produce a code map and acceptance-test design. A recorded plan declares `ownedPaths`. File overlap with another open PR blocks the delivery.

## Verification loop

Use only the real CLI:

```bash
npm run delivery -- next
npm run delivery -- begin <id>
npm run delivery -- record <stage> <result.json>
npm run delivery -- verify quick
npm run delivery -- verify final
npm run delivery -- verify bootstrap # one-time harness installation only
npm run delivery -- gate publish
npm run delivery -- remote <pr-number>
npm run delivery -- gate stop
npm run delivery -- check-config
```

`verify quick` executes typecheck and tests. `verify final` always executes typecheck, tests, build, and Playwright E2E. It additionally executes Firebase E2E, rules tests, or dependency audit when the diff requires them.

The CLI stores local evidence in ignored `.delivery/runs/<run-id>/`: spec hash, base/head SHA, transitions, command, exit code, output, reviews, and Preview results. An agent cannot record command success manually. A command with a missing script or nonzero exit code blocks. Agents never mutate `.delivery/runs` directly; only the lifecycle hook and delivery CLI may write evidence.

## Candidate review

Create a clean candidate commit before final verification. Three independent `store-os-reviewer` runs review the same SHA in parallel:

1. Store OS standards and approved spec, including `store-os-review`.
2. Security, multistore isolation, Firebase, privacy, production safety, and zero cost.
3. Acceptance coverage, real UI behavior, regression risk, and evidence.

Each result carries a distinct reviewer run ID plus its exact lens; the CLI rejects reused identities or mismatched lenses.
`SubagentStop` writes a local receipt that binds the actual agent ID, profile, result hash, and candidate SHA. Hand-written reviewer identities are rejected, and prior blocking findings remain in history until an adversarial receipt covers them.

Every blocking finding receives an independent adversarial verdict. `confirmed` and `uncertain` require a fix. `refuted` requires reproducible evidence. Any code change invalidates final verification and all reviews. More than two correction rounds becomes `BLOCKED_HUMAN`.

The code PR contains `.delivery/completed/<id>.json` with `id`, `specPath`, and `deliveryStatus: "implemented"`. It marks completion only after a human merges it into `main`.
That PR cannot change any delivery spec, the queue, or completion markers for any other delivery. Before publish, the harness refreshes `origin/main` again and rejects a concurrently completed, frozen, changed, or dependency-blocked item.

## Publication and remote gate

Push and draft-PR creation require a current local publish gate. The PR body includes `Delivery-ID`, spec path, candidate SHA, and final commands.

CI must pass `delivery check-config` and the applicable application suites. Every queued item declares at least one browser check. The Preview comment must come from the GitHub Actions bot, name the exact candidate SHA, and point to an HTTPS `*.vercel.app` deployment; `delivery remote` verifies those bindings, requires every mandatory job to be `SUCCESS`, and executes the queue's `previewChecks` using Playwright. Private flows use Firebase Emulator, never production data.

A second independent PR may start only after the current PR reaches `REMOTE_GREEN`. PRs remain draft for human review.

## Hard boundaries

Agents never:

- merge a PR or mark it ready;
- push to `main`;
- deploy production;
- run a production read or mutation;
- use `--apply` without a separate second human approval;
- weaken tests, authorization, multistore isolation, privacy, or zero-cost constraints.

Project hooks enforce Stop, SubagentStop, and PreToolUse with exit code 2. They cover Bash, ordinary file edits, and MCP mutations, including direct evidence changes. Project-local Codex hooks must be reviewed and trusted once through `/hooks`. Hooks are guardrails within the client permission model, not a security boundary against an unrestricted same-user process; Codex documents that some specialized tool paths may bypass tool hooks.

A run may stop only at `WAITING_SPEC_APPROVAL`, `BLOCKED_HUMAN`, an empty/not-active queue, or `REMOTE_GREEN`. The successful item result is exactly:

`DRAFT PR GREEN — READY FOR HUMAN REVIEW`

Anything else is an explicit blocker, never a claim that production is approved.
