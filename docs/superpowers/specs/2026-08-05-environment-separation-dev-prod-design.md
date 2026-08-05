# Environment separation: dev vs production

**Status:** Approved (2026-08-05)
**Branch:** `feat/env-separation-dev-prod`

## Problem

Store OS has **one Firebase project** (`store-os-f7cf8`) serving every
non-emulator target: local-real dev, Vercel Preview, and Vercel Production.
There is no firewall between them. As Olivia's jewelry store enters real
production use, any change tested on a Preview deployment (or a stray local
build pointed at the real backend) can **create, edit, or delete her actual
business data**. A bug, a seed, or a misconfigured env var can affect the
operation and therefore the business economically.

The local emulator (`store-os-demo` namespace, volatile) is correctly isolated.
The gap is the **preview ↔ production** boundary, which does not exist today.

## Outcome

Development/testing cannot touch production data, and production cannot be
modified except by Olivia operating the real business. Specifically:

- A second Firebase project `store-os-dev` is the backend for Preview and
  local-real development. Production (`store-os-f7cf8`) serves only Vercel
  Production.
- A build-time guard aborts any Vercel build whose `VITE_VERCEL_ENV`/project-id
  combination is inconsistent (Preview pointing at prod, or production pointing
  at dev) — defense-in-depth against env-var misconfiguration.
- The `super_admin` bootstrap ("first user wins") is hardened with an email
  allowlist in `firestore.rules` so that an empty `users/` collection can never
  escalate an arbitrary signup.
- Olivia is the **only** account in production; the development account cannot
  authenticate against prod.
- The production API key is restricted by HTTP referrer and rotated.
- Zero cost is preserved: the Blaze free tier is **per-project**, dev is used by
  one person, Phone Auth is never enabled, and the dev Storage bucket stays in
  `us-east1`.

## Non-goals (this iteration)

- CI on push (no CI exists yet; out of scope — the build guard runs in every
  Vercel build, which is the practical gate).
- A "staging" environment (only dev + prod; YAGNI).
- E2E tests that assert cross-project isolation automatically (manual checklist
  in the runbook; a real cross-project e2e would need two live projects and is
  brittle).
- Rotating every secret (only the prod Web App API key + appId; Storage/Auth
  keys are unchanged).
- Test data seeding automation for dev (manual for now; one developer).

## Scope split: repo vs console

This change is ~20% repo and ~80% console. The delivery FSM owns the **repo**
portion; the console portion is a runbook executed by the human (no agent can
touch Firebase/Vercel/GCP consoles).

### Repo (what the FSM builds, reviews, secures)

1. **`.firebaserc`** — add `"dev": "store-os-dev"` alias. `firebase deploy`
   (default) → prod; `firebase deploy --project dev` → dev. (Already committed
   as draft `9806a8c` on the branch — to be audited by the FSM's reviewers.)
2. **`scripts/check-env.cjs`** (new, Node CommonJS) — build-time guard. Reads
   `VITE_VERCEL_ENV` (auto-injected by Vercel) + `VITE_FIREBASE_PROJECT_ID`.
   Fails the build on mismatch: Preview+prod project, or Production+non-prod
   project. Self-test via `--test`. Hooked into the `build` npm script *before*
   `tsc`/`vite`. (Already drafted, uncommitted — to be audited/replaced by the
   FSM.)
3. **`firestore.rules`** — email allowlist for `super_admin` creation. In
   `match /users/{uid}`, `allow create` of `super_admin` is permitted only if
   `request.resource.data.email` is in a hardcoded allowlist. `member` creation
   stays open to self-signup. The allowlist holds Olivia's email(s).
4. **`docs/DEPLOYMENT.md`** — new section "Ambientes (dev vs prod)": project
   table, per-target Vercel env-var matrix, isolation checklist, API-key
   rotation runbook, Phone-Auth + IAM-grant notes.

### Console (human runbook, not in repo)

- **Fase 0 — Create `store-os-dev`:** Firestore (production mode, US region),
  Storage bucket (`us-east1` — mandatory for free tier), Auth (Email/Password +
  Google, **never Phone**), Web App (6 config values), $0.01 budget alert, IAM
  grant `roles/datastore.user` on the Storage service agent.
- **Deploy rules to dev:** `firebase deploy --only firestore,storage --project dev`.
- **Vercel env vars:** scope Production → `store-os-f7cf8` values (Production
  only); Preview + Development → `store-os-dev` values. **No** var with scope
  "All Environments".
- **Seed + lock prod:** confirm Olivia is the sole user in prod; if not
  registered, register her first (she becomes `super_admin` via the now-
  allowlisted bootstrap). Remove any dev account that leaked into prod.
- **Restrict + rotate prod key:** restrict the prod API key by HTTP referrer to
  the Vercel prod domains; then delete + recreate the prod Web App for a fresh
  `apiKey`/`appId`, update Vercel Production env, re-auth.

## Data model

No entity changes. No new collections. The change is configuration + one rules
clause + one build script.

## Security model

- **Primary isolation = distinct Firebase project.** Firebase Auth UIDs are
  per-project (the same Google account yields different UIDs in each project),
  and Security Rules have no notion of "environment". So pointing Preview at
  `store-os-dev` physically separates Auth, Firestore, and Storage from prod.
- **Defense-in-depth layer 1 = the build guard** (`check-env.cjs`). Catches the
  common accident of a Preview inheriting prod env vars. Not primary security
  (the public config can instantiate the SDK regardless) — it is a build-time
  tripwire.
- **Defense-in-depth layer 2 = the `super_admin` allowlist** in
  `firestore.rules`. Closes the "empty `users/` → next signup escalates" risk.
- **Defense-in-depth layer 3 = HTTP-referrer restriction + rotation** of the prod
  key, limiting blast radius if the key reaches the wrong bundle.

## Risks

- **Dominant risk:** a Vercel env var left on "All Environments" pointing at
  prod. Mitigated by the build guard + scoped env vars + the post-deploy
  isolation checklist.
- **Phone Auth enabled by accident** in either project → SMS charges, breaks
  zero-cost. Mitigated by an explicit "never touch Phone" rule in the runbook
  and the final checklist.
- **Dev Storage bucket outside `us-east1`** → Storage charges from the first
  byte. Bucket location is immutable after creation; the runbook forces
  `us-east1`.
- **Bootstrap escalation** if prod `users/` is emptied. Mitigated by the
  allowlist; also: prod `users/` is never deleted.
- **Free-tier "per billing account vs per project" ambiguity** in old docs.
  Official current docs say per-project; practical impact is nil for
  single-developer dev usage. Monitor Usage & Billing in both projects for a
  few days after creating dev.

## Acceptance criteria (observable)

Repo portion (FSM-verifiable):
- `npm run typecheck`, `npm run test`, `npm run build`, `npm run e2e` pass.
- `node scripts/check-env.cjs --test` passes its self-test.
- Simulated `VITE_VERCEL_ENV=preview VITE_FIREBASE_PROJECT_ID=store-os-f7cf8
  npm run build` **fails** with the Spanish block message.
- `firestore.rules` validates (`npm run e2e:firebase` exercises them on the
  emulator) and the allowlist clause rejects a `super_admin` create from a
  non-allowlisted email.
- `docs/DEPLOYMENT.md` has the "Ambientes (dev vs prod)" section.

End-to-end isolation (human-verified via the runbook checklist, reported but
not FSM-automated):
- Registering on a Preview deploy creates a user in `store-os-dev`, **not** in
  `store-os-f7cf8`.
- Creating a store on Preview appears in dev Firestore, not prod.
- Uploading a product photo on Preview lands in dev Storage, not prod.
- Production deploy logs show `project: store-os-f7cf8, target: production`;
  Preview logs show `project: store-os-dev, target: preview`.
- Olivia is the sole Authentication user in prod.
