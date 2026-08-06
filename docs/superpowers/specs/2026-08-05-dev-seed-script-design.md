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

The script seeds **only the Olivia store** (slug `olivia`, same as prod — safe
because `store-os-dev` and `store-os-f7cf8` are separate projects). It reuses
the Olivia data from `src/lib/seed.ts`'s `buildSeedState()` as the starting
point, but the script **cannot import the TypeScript directly** (the repo is
`type:module`; `scripts/` runs as plain Node CommonJS; `tsconfig` is `noEmit`).
Instead the script uses a small build step: it imports the seed via a transpiled
JS shim produced at dev-time, OR (simpler, ponytail) re-declares the Olivia data
inline in the script as a self-contained object. The implementer picks the
bridge; the contract is "the same Olivia entities buildSeedState() produces,
deterministic fixed ids for idempotent re-run". The script then:

1. **Authenticates via `firebase-admin` using Application Default Credentials
   (ADC)** — NOT a password, NOT a client-SDK login. ADC is established once by
   the developer with `gcloud auth application-default login` (a one-time browser
   login; no committed secret, no password file, **no `.env.seed-dev`**). The
   Admin SDK reads ADC automatically. If ADC is absent, the script prints the
   exact `gcloud` command to run and exits. (All references to `.env.seed-dev`
   were removed — auth is ADC-only.)
2. Initializes the Admin SDK **against `store-os-dev` only** by hardcoding the
   dev projectId. It MUST assert the projectId is `store-os-dev` and abort
   otherwise (a guard, like check-env.cjs). This guard is **load-bearing**:
   the Admin SDK bypasses Security Rules entirely, so if the script ever
   targeted prod it would write unimpeded — the guard is the only thing
   preventing that, and it must run BEFORE any Firestore or Storage call.
3. **Resolves the admin uid at runtime.** ADC authenticates the Admin SDK as the
   project's service agent, not as a user, so there is no user uid by default.
   The script looks up the `admin@store.os` user in Auth
   (`admin.auth().getUserByEmail('admin@store.os')`) to get its uid, and sets
   `ownerUid`/`memberUids` on the Olivia store to that uid. (`buildSeedState()`
   does NOT set these fields; the seed must add them or the deployed rules would
   block a normal client from reading the store.) If the admin user doesn't
   exist in dev yet, the script aborts with a clear message (the human creates
   it by signing up once on the Preview, as already done this session).
4. Writes the Olivia store + its categories + products + customers + orders to
   dev Firestore via the Admin SDK (`setDoc`), scoped to `storeId === store_olivia`.
5. **Enriches the Olivia products** before writing, because `buildSeedState()`
   products lack two fields the public projection requires: `slug` (generate from
   the product name, deterministic) and `images` (populated in step 7 after the
   upload). Without `slug`, `projectPublicForStore()` skips the product
   (`if (!p.slug) continue`), so `/catalogo/olivia` would have no product detail
   pages. The seed assigns a `slug` to each Olivia product.
6. Claims the slug `olivia` in `slugs/` and writes the public projections
   (`publicStores`, `publicCatalogs`, `publicProducts`) so `/catalogo/olivia`
   works on the Preview deploy. (The Admin SDK bypasses the membership guards on
   these collections; the seed writes them directly, mirroring what
   `projectPublicForStore` does for a normal client.)
7. **Uploads 1–2 generated sample JPEGs** (a solid-color JPEG built in-code, no
   binary asset) to `products/{storeId}/{productId}/*.jpg` in the dev Storage
   bucket via the Admin SDK. The object name MUST end in `.jpg` and the
   `contentType` MUST be `image/jpeg`, size < 5 MB — to satisfy `storage.rules`
   `validImage()` (even though Admin bypasses rules, matching the contract keeps
   the generated data consistent with what a real client upload produces). The
   uploaded URLs are then linked into one Olivia product's `images` gallery
   (`isPrimary: true` on the first), and the product doc is updated + re-projected
   — validating the dev Storage + IAM grant end-to-end.

`firebase-admin` is added as a **devDependency** (never in the client bundle;
the script runs in Node only, and the plan must confirm Vite does not bundle it).

## Data model

No type changes. The seed data mirrors the current `Store`/`Product`/`Category`/
`Customer`/`Order` shapes, sourced from `buildSeedState()` (Olivia subset) and
enriched with the missing fields (`slug`, `images`, `ownerUid`/`memberUids`)
required for the data to be readable and projectable under the deployed rules.

## Security model

- **Dev-only guard (load-bearing):** the script aborts unless the projectId is
  exactly `store-os-dev`. Because the Admin SDK ignores BOTH Firestore and
  Storage Security Rules, this guard is the SOLE protection against writing prod
  — it must be a hard, tested assertion that runs before any write.
- **Credentials:** ADC only (`gcloud auth application-default login`). No
  password, no service-account JSON committed, **no `.env.seed-dev`**. ADC lives
  in the user's gcloud config, never in the repo.
  secret; access is enforced by rules, and the Admin SDK here is deliberately
  scoped to dev by the guard).
- The seed sets `ownerUid`/`memberUids` so the data is visible under the deployed
  `firestore.rules` when a normal client (admin/Olivia) signs in.

## Risks

- **Wrong project write** (script writes prod). Mitigated by the dev-only guard
  + the fixed dev config (the script does not read arbitrary env, it's hardcoded
  to dev). This is the load-bearing risk because Admin bypasses rules.
- **No credentials to leak:** auth is ADC (in the user's gcloud config), not a
  committed password or key. No `.env.seed-dev`, no secret in the repo.
- **Admin user missing in dev:** the script looks up `admin@store.os` in Auth to
  set `ownerUid`/`memberUids`; if absent it aborts with a clear message (the
  human signs up once on the Preview — already done this session).
- **Incomplete seed data:** `buildSeedState()` products lack `slug`/`images`;
  the seed enriches them (slug from name; images after upload) so the public
  projection works and `/catalogo/olivia` shows product detail pages.
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
- The script aborts cleanly if ADC is absent, printing the exact
  `gcloud auth application-default login` command.
- `firebase-admin` is in `devDependencies` (not `dependencies`), and the client
  build (`npm run build`) does not pull it into the bundle.
- A `README` line / DEPLOYMENT.md note documents how to run the seed
  (one-time `gcloud auth application-default login`, then `node scripts/seed-dev.cjs`).

End-to-end (human-verified via the Preview, reported but not FSM-automated):
- After `node scripts/seed-dev.cjs`, the `store-os-dev` Firestore has the Olivia
  store + categories + products + customers + orders.
- `/catalogo/olivia` on the Preview deploy shows the seeded public catalog.
- A product shows the uploaded sample image (Storage + IAM grant work).
- `store-os-f7cf8` (prod) is **untouched** (no writes happened there).
