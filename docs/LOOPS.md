# Store OS Engineering Loops

Background engineering guide. The normative workflow lives in root `LOOPS.md`; this document is guidance, not a gate.

## 1. Why loops

"Done" is not "I wrote the code." Done means:

- The **real user flow** works in a real browser, end to end.
- `build`, `test`, and `e2e` pass.
- **Release blockers** are known and stated — none hidden.
- **Risks** are reported honestly, including the ones you did not fix.

A loop forces you to validate, observe failure, and fix before claiming progress. Skipping validation to "move fast" is how login breaks in production. The loop is the speed.

## 2. Loop stack

Five loops nest. Know which one you're running.

- **Execution Loop** — the innermost cycle: **inspect → edit → validate → observe failure → fix → repeat.** Run this for every change, however small. Never declare a change done without one validation pass.
- **Task Loop** — one bounded task: a **goal**, **acceptance criteria**, **validation commands**, **minimal fixes only**, and a **final report**. A task is one logical change, not a batch.
- **Release QA Loop** — full verification **before Vercel**: real browser flows, bug classification (blocker / non-blocker), fix blockers, repeat until clean. See §4–§6.
- **Product Loop** — **human decides capability → spec → agent implements → QA → deploy → feedback → next step.** No feature starts without a spec the human signed off on.
- **Oversight Loop** — **human-owned.** Sets goals, limits scope, stops runaway complexity, approves release. **The human stays in this loop.** The agent never self-approves a release.

> Scope creep stops here: if a change starts pulling in a new capability, halt and return to the Product Loop for a spec.

## 3. Standard commands

```bash
npm install       # one-time, then after dependency changes
npm run build     # tsc --noEmit + vite build — typecheck AND bundle
npm run test      # vitest (unit + design-system gate)
npm run e2e       # playwright (smoke + responsive + theme)
npm run verify    # NOT A SCRIPT — see note below
npm run dev       # local dev server on 5173 (demo mode, no backend)
```

Extra, used when relevant:

```bash
npm run typecheck        # tsc --noEmit only
npm run e2e:firebase     # Firebase emulator suite (needs `npm run emulators`)
npm run emulators        # Auth + Firestore + Storage emulators on localhost
npm run deploy:rules     # human-only production operation; agents never execute it
```

> **`npm run verify` does NOT exist in this repo.** If asked to run it, **report that it is not defined** — do not pretend success and do not invent a substitute. The closest real equivalent is `npm run build && npm run test && npm run e2e`. Same rule for any other missing script: **say it's missing, don't fake it.**

## 4. Draft PR ready for human review

A draft PR is reviewable only when CI (`build-test` + `rules-and-e2e`) is green and this checklist holds:

- `npm run build` passes
- `npm run test` passes
- `npm run e2e` passes
- App runs locally (`npm run dev`)
- **No release blockers** (see §5)
- Admin flows work (stores, products, customers, orders)
- Public catalog works (`/catalogo`, `/catalogo/:slug` in demo)
- Store isolation works (no cross-store leak)
- No secrets committed (no keys, tokens, service accounts in the diff)
- Env requirements documented (which vars Vercel needs)

If any one fails, report the exact blocker. The only successful verdict is **DRAFT PR GREEN — READY FOR HUMAN REVIEW**.

### Environment synchronization (STRICT, non-negotiable)

Store OS runs three environments. Their synchronization rule is invariant and
governs every change:

- **Development (local) and Preview share one backend (`store-os-dev`)**. Data
  persists across both — what the developer validates locally is what UAT/Preview
  shows. **Production (`store-os-f7cf8`) is fully isolated**; its data never
  crosses into dev/preview and vice versa.
- **Structure flows to all three environments, always in sync.** "Structure"
  means Firestore schema (collections, fields), Security Rules, Storage rules,
  IAM/permissions, and any code that defines how data is shaped or accessed.
  When a change alters structure, that same structure is deployed to dev,
  preview, **and** prod — no environment drifts structurally.
- **The promotion order is fixed and linear:** **local (code written and tested)
  → Preview (validated by Fer as a real user) → Production (only with Fer's
  explicit approval).** Nothing skips a stage. The developer (agent) never
  self-promotes to Production; human approval (Fer/PO) is the sole gate to prod.
- **Data is never promoted.** Only structure and code flow across environments.
  Seeding test data belongs only in dev/preview (`scripts/seed-dev.cjs`, which
  hard-aborts unless `projectId === 'store-os-dev'`). Production is never seeded.

A change that would cause structural drift between environments (e.g. a new
collection read in code but no rule for it, or a rule deployed to dev but not
prod) is a release blocker — fix it before deploy.

## 5. Release blockers

Any of these blocks release — fix before deploy, no exceptions:

- Login broken
- Create store broken
- Store switcher broken ("¿Quién opera hoy?")
- Product / customer / order creation broken
- Image upload broken
- Order status update broken
- Public catalog broken
- Private data exposed publicly
- Cross-store data leak
- Firestore / Storage rules broken
- `build` / `test` / `e2e` failure

Non-blockers (UX polish, nice-to-haves) get logged, not deployed-blocking — but they must be **reported**, not silently dropped.

## 6. Required browser flows

Before claiming "done" or "ready," validate these **in a real browser**, not by reading code:

- Login / logout
- Create store
- Switch store
- Create product
- Create customer
- Create order
- Advance order status
- Publish a product
- Open `/catalogo`
- Open `/catalogo/:slug`
- Verify private data is hidden (costs, members, customer info not in public view)
- Mobile viewport smoke test (tap targets ≥ ~40px, inputs ≥ 16px, no iOS zoom)

> "I see the route handler exists" is **not** validation. Click through the UI.

## 7. Failure protocol

When something fails, follow the cycle — no shortcuts:

```
TEST → FAIL → ROOT CAUSE → MINIMAL FIX → RETEST
```

Rules:

- **Do not guess.** Read the failure, read the code, find the cause.
- **Do not mark done if a real UI flow fails**, even if tests pass.
- **Do not bypass the UI** (curling an endpoint, mocking a store) and then claim user-flow success.
- **Fix the smallest thing needed.** No drive-by refactors.
- **Add or update a regression test** when practical, so it can't come back.

If root cause is unclear, stop and use systematic debugging before touching code.

## 8. Agent constraints

Agents must **not**:

- Add features without a spec (Product Loop owns this).
- Redesign casually — visual decisions go through design-system tokens.
- Refactor for taste.
- Change infra casually (Firebase rules, deployment config, env).
- **Cause structural drift between environments** — see §4 "Environment synchronization": schema/rules/permissions/structure must flow to dev, preview, AND prod in sync; data stays isolated in dev↔preview; promotion is local→preview→prod with human approval. Structural drift is a release blocker.
- Weaken or delete tests to make them pass.
- Disable TypeScript checks (`any` everywhere, `// @ts-ignore` to silence).
- Make private data public.
- Expose secrets or commit credentials.
- Claim readiness without running the validation commands.

When in doubt, do less and report it.

## 9. Reporting standard

Every **final report** includes all of:

- **Goal summary** — what was the task.
- **Files changed** — paths.
- **Commands run** — and their real output status.
- **Tests passed/failed** — counts, not "looks good."
- **Browser flows validated** — which of §6, with notes.
- **Bugs found/fixed** — one line each.
- **Remaining issues** — including non-blockers.
- **Release blocker status** — clear or list the blockers.
- **Final verdict** — `DRAFT PR GREEN — READY FOR HUMAN REVIEW` or the exact blocker.

No verdict without evidence. "Should work" is not a verdict.

## 10. Templates

### Feature Goal Template

```
Task: <one bounded change>
User flow: <who does what, in the UI, end to end>
Acceptance criteria:
  - <observable outcome 1>
  - <observable outcome 2>
Validation commands:
  - npm run build
  - npm run test
  - npm run e2e
Browser validation:
  - <flow from §6 this touches>
Constraints:
  - minimal diff, design-system tokens, Spanish UI, mobile-first
  - no features beyond the spec
Release blockers introduced/removed: <none / list>
Final report: <fill per §9>
```

### Release QA Goal Template

```
Mission: <verify release X for deploy>
Scope: <in scope / out of scope>
Commands:
  - npm run build
  - npm run test
  - npm run e2e
Required flows: <the §6 list, checked off>
Bug severity:
  - blocker: <must fix before deploy, see §5>
  - non-blocker: <log, ship, report>
Fix policy: fix blockers with minimal diffs; do not expand scope
Final verdict: DRAFT PR GREEN — READY FOR HUMAN REVIEW / <exact blocker>
```
