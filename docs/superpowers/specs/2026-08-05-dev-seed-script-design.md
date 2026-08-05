# Dev seed script: populate `store-os-dev` with realistic test data

**Status:** Approved (2026-08-05)
**Branch:** TBD (off `main`)

## Problem

`store-os-dev` (the isolated development Firebase project) is now live and
configured, but it is **empty of data**. The developer (Álvaro) needs a
populated dev environment to work against — to test features (receipts coming
next), reproduce issues, and validate changes without touching Olivia's real
production data. An empty dev is useless for that.

Álvaro will not seed data by hand unless strictly necessary; this must be a
one-command, reproducible operation. It must be delivered through the delivery
harness (software-delivery FSM), like env-separation was.

## Outcome

A single Node script (`scripts/seed-dev.cjs`) that, when run, populates
`store-os-dev` with a realistic jewelry store ("Olivia", slug `olivia` — same
name/slug as prod; safe because the projects are separate) plus its products,
categories, customers, orders, and 1–2 sample product photos in Storage. Running
it again is idempotent (overwrites the same fixed ids, no duplicates). It can
**only** target `store-os-dev`, never production.

## Non-goals (this iteration)

- A live sync from prod → dev (a copy that stays current). Decided against: data
  copies age instantly, double free-tier consumption, and data does not flow
  between environments the way code does (it would need re-capture by hand). Dev
  gets a realistic **synthetic** seed instead, reusing the existing
  `buildSeedState()`.
- Seeding production (the script is dev-only by design).
- A UI for seeding (CLI script is enough).
- Reset/cleanup subcommand beyond idempotent re-run (fixed ids make re-run a
  clean overwrite; a separate wipe is out of scope, `firebase emulators` /
  Firestore console handles that).
- Suppliers/purchases seed (buildSeedState may not include them; YAGNI — seed
  the core: stores, categories, products, customers, orders).

## Approach

Reuse `src/lib/seed.ts`'s `buildSeedState()` — it already constructs a complete,
realistic Olivia jewelry store (storefront, categories, products with tiers and
stock, etc.) with deterministic fixed ids (idempotent on re-run). The script:

1. **Authenticates via `firebase-admin` using Application Default Credentials
   (ADC)** — NOT a password, NOT a client-SDK login. ADC is established once by
   the developer with `gcloud auth application-default login` (a one-time browser
   login; no committed secret, no password file). The Admin SDK reads ADC
   automatically. If ADC is absent, the script prints the exact `gcloud` command
   to run and exits.
2. Initializes the Admin SDK **against `store-os-dev` only** by hardcoding the
   dev projectId. It MUST assert the projectId is `store-os-dev` and abort
   otherwise (a guard, like check-env.cjs). This guard is **load-bearing**:
   the Admin SDK bypasses Security Rules, so if the script ever targeted prod it
   would write unimpeded — the guard is the only thing preventing that.
3. Writes the seed state to dev Firestore via the Admin SDK (`admin.firestore()`
   `setDoc` against collections `stores`, `categories`, `products`, `customers`,
   `orders`), including the membership fields (`ownerUid`, `memberUids`) set to
   the admin uid so the data is readable under the deployed rules when Fer/admin
   signs in normally.
4. Claims the slug `olivia` in `slugs/` and writes the public projections
   (`publicStores`, `publicCatalogs`, `publicProducts`) so `/catalogo/olivia`
   works on the Preview deploy too.
5. Uploads 1–2 generated sample images (a solid-color JPEG built in-code, no
   binary asset needed) to `products/{storeId}/{productId}/*.jpg` in the dev
   Storage bucket via the Admin SDK, and links them on one product's `images`
   gallery — validating the dev Storage + IAM grant end-to-end.

`firebase-admin` is added as a **devDependency** (never in the client bundle;
the script runs in Node only).

## Data model

No type changes. Reuses `buildSeedState()` output verbatim. The seed already
matches the current `Store`/`Product`/`Category`/`Customer`/`Order` shapes
(it's the same seed the local demo and initial cloud seed use).

## Security model

- **Dev-only guard (load-bearing):** the script aborts unless the projectId is
  exactly `store-os-dev`. Because the Admin SDK ignores Security Rules, this
  guard is the SOLE protection against writing prod — it must be a hard,
  tested assertion that runs before any write.
- **Credentials:** ADC (Application Default Credentials), established once via
  `gcloud auth application-default login`. No password, no service-account JSON
  committed, no `.env.seed-dev`. ADC lives in the user's gcloud config, never in
  the repo.
- **Public config:** the dev projectId is safe to hardcode (project id is not a
  secret; access is enforced by rules, and the Admin SDK here is deliberately
  scoped to dev by the guard).
- The seed sets `ownerUid`/`memberUids` so the data is visible under the deployed
  `firestore.rules` when a normal client (admin/Olivia) signs in.

## Risks

- **Wrong project write** (script writes prod). Mitigated by the dev-only guard
  + the fixed dev config (the script does not read arbitrary env, it's hardcoded
  to dev).
- **Credential leakage** (admin password committed). Mitigated by gitignored
  `.env.seed-dev`; the script refuses to run without it.
- **Free-tier consumption:** a seed is a handful of writes (≈ a dozen docs + 2
  uploads); negligible against the 20K writes/day, 5K uploads/month dev quota.
  Idempotent re-runs overwrite, they don't accumulate.
- **Storage 403** if the dev IAM grant is missing. The seed's image upload will
  surface it loudly (the script reports the error); the grant was applied this
  session so it should pass.
- **`buildSeedState()` drift:** if the type shapes change, the seed may need a
  bump. Mitigated by reusing the existing seed (kept in sync with the app).

## Acceptance criteria (observable)

Repo portion (FSM-verifiable):
- `npm run typecheck`, `npm run test`, `npm run build`, `npm run e2e` pass.
- `scripts/seed-dev.cjs` exists, is runnable with `node scripts/seed-dev.cjs`,
  and aborts with a clear Spanish message if run when the projectId is not
  `store-os-dev` (a self-test or simulateable assertion).
- The script aborts cleanly if `.env.seed-dev` is absent, printing instructions.
- `.env.seed-dev` is gitignored.
- A `README` line / DEPLOYMENT.md note documents how to run the seed.

End-to-end (human-verified via the Preview, reported but not FSM-automated):
- After `node scripts/seed-dev.cjs`, the `store-os-dev` Firestore has the Olivia
  store + categories + products + customers + orders.
- `/catalogo/olivia` on the Preview deploy shows the seeded public catalog.
- A product shows the uploaded sample image (Storage + IAM grant work).
- `store-os-f7cf8` (prod) is **untouched** (no writes happened there).
