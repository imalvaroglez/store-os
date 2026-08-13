# ADR 0001 — Autonomous, Verifiable Delivery Harness

- **Status:** Amended
- **Date:** 2026-08-12
- **Deciders:** Repository owner (Álvaro González), Codex
- **Supersedes:** the linear FSM/workflow implementation accepted on 2026-08-04

## Context

The previous harness modeled many states and agents, but its executable path was linear and accepted worker-reported `commandsExecuted` without running those commands. That made it possible to skip testing, carry stale review evidence to a new SHA, or declare completion without a remote Preview.

Store OS needs autonomy up to a green draft PR, while approval, merge, production, and production data remain human-owned.

## Decision

Use one small Node.js CLI, `scripts/delivery-harness.cjs`, as the executable source of truth.

- `.delivery/queue.json` selects work strictly by priority.
- Approved specs merged into `main` authorize code; a pending spec authorizes documentation only.
- `.delivery/runs/<run-id>/` stores ignored, SHA-bound local evidence.
- `.delivery/completed/<id>.json` marks completion only after the code PR reaches `main`.
- One writer implements; read-only explorers and three independent reviewers may run in parallel.
- Real commands, exit codes, final reviews, CI, Preview, and browser checks gate publication.
- Shared lifecycle hooks block missing gates, malformed subagent results, merge, push to `main`, and production operations.
- Codex and Claude Code use equivalent delivery skills and agent roles.

## Alternatives considered

- **Keep the FSM and fix its executor:** rejected because two mirrored state files, a simulator, schemas, and fourteen roles added more surface than the required controls.
- **Agent instructions only:** rejected because instructions cannot prove that commands ran or that evidence belongs to the current SHA.
- **Parallel writers/worktrees:** deferred. Store OS is small enough that one writer plus overlap detection is safer and simpler.
- **New validation dependencies:** rejected. The CLI uses Node.js standard library and existing Playwright.

## Consequences

- Tests and remote checks decide progress; prose cannot.
- Missing GitHub access, missing evidence, dirty trees, stale SHA, dependency conflicts, and file overlap fail closed.
- Unspecced work pauses in a draft documentation PR.
- More than two correction rounds escalates to `BLOCKED_HUMAN`.
- Agents may create branches, commits, pushes, draft PRs, and Preview checks, but never merge or touch production.
- Project hooks require a one-time trust review in Codex through `/hooks`.
- The installation PR uses one owner-approved bootstrap manifest because the queue cannot govern its own introduction. The exception is bound to the pre-harness `main` SHA, exact branch and file scope, runs the real final checks, permits only a draft PR, and expires when `main` advances.
