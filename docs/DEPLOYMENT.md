# Deployment guide

Store OS is a static SPA (Vite build) + Firebase (Auth + Firestore). Deploy the
frontend to **Vercel** and point it at a real Firebase project. This guide covers
both.

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> → **Add project**.
2. **Build → Authentication → Sign-in method:** enable **Email/Password** and
   **Google**.
3. **Build → Firestore Database → Create database** (production mode). Pick a
   region close to your users.
4. **Build → Storage → Get started** (creates the default bucket). Browser photo
   uploads need CORS configured on the bucket — see step 4.
5. **Project settings → Your apps → Web (`</>`)** → register a web app → copy the
   `firebaseConfig` values (apiKey, authDomain, projectId, …).

## 2. Set environment variables on Vercel

The public Firebase config is safe to ship in the client bundle — access is
enforced by **Security Rules**, not by hiding these keys. In your Vercel project
(Settings → Environment Variables), add:

| Variable | Value |
|----------|-------|
| `VITE_FIREBASE_API_KEY` | from firebaseConfig |
| `VITE_FIREBASE_AUTH_DOMAIN` | `_<projectId>_.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | your project id |
| `VITE_FIREBASE_STORAGE_BUCKET` | `_<projectId>_.appspot.com` |
| `VITE_FIREBASE_SENDER_ID` | messaging sender id |
| `VITE_FIREBASE_APP_ID` | app id |

**Do NOT set** `VITE_FIREBASE_EMULATOR` in production — that flag routes Auth +
Firestore to localhost (it's for local tests only).

## 3. Deploy the security rules

The repo ships `firestore.rules` (data) and `storage.rules` (product photos).
Deploy them once (and on rule changes):

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore,storage
```

(Or `npm run deploy:rules`, which runs the same.) The Storage rules allow public
read (the anonymous catalog loads photos) and require store membership to
write/delete, verified via a cross-service Firestore lookup.

## 4. Configure Storage CORS (required for browser uploads)

Browser uploads to Firebase Storage trigger a CORS preflight. Buckets ship with
**no CORS config by default**, so uploads from your Vercel domain fail with a
preflight/CORS error until you set it. The repo's `cors.json` allows all origins
(`*`) — safe, because Storage rules still enforce auth on writes; CORS only gates
which browser origins may attempt the request.

Apply it with `gsutil` (Google Cloud SDK; `gcloud auth login` first):

```bash
gsutil cors set cors.json gs://<projectId>.firebasestorage.app
gsutil cors get gs://<projectId>.firebasestorage.app   # verify
```

Use the bucket name from `VITE_FIREBASE_STORAGE_BUCKET`.

## 4b. Grant Storage access to Firestore (required for cross-service rules)

`storage.rules` uses `firestore.get()` to verify store membership on every
photo write (a **cross-service** Storage→Firestore read). For this to work, the
project's **Cloud Storage service agent must be allowed to read Firestore**.
Without it, every upload returns `storage/unauthorized` (HTTP 403) — even for
the super-admin owner — because the membership lookup silently fails.

This is a one-time IAM grant (no cost; it's a permission, not a billable
operation). The `firestore.get()` calls count as normal Firestore reads against
your daily quota (2 per photo upload — negligible under the free tier).

```bash
# projectNumber is on the Firebase console "Project settings" overview, or:
gcloud projects describe <projectId> --format="value(projectNumber)"

gcloud projects add-iam-policy-binding <projectId> \
  --member="serviceAccount:service-<projectNumber>@gcp-sa-firebasestorage.iam.gserviceaccount.com" \
  --role="roles/datastore.user" \
  --condition=None
```

**How to tell it's missing:** uploads fail with `storage/unauthorized` but a
temporary rule of `allow create: if request.auth != null` works. That pinpoints
the cross-service `firestore.get()` as the failing guard. The Storage emulator
does **not** reproduce this — it can't evaluate `firestore.get()` at all (see
`storage.rules.emulator` + `scripts/e2e-firebase.sh`), so membership is only
verified against the real backend.

## 5. Deploy to Vercel

```bash
npm install
npm run build          # verify locally first
```

Then either:
- **Vercel dashboard:** import the GitHub repo; framework auto-detected (Vite);
  add the env vars from step 2; deploy.
- **CLI:** `npm i -g vercel && vercel` (link the project, add env vars, deploy).

`vercel.json` already sets the SPA rewrite (so deep links like `/catalogo/:slug`
work on refresh) and long-cache headers for `/assets/*`.

## 6. First user = super-admin

The very first account created on the deployed app becomes the **super_admin**
(you). Sign up, then invite store owners by email from each store's settings.

`super_admin` is the platform operator: the role can open and edit any store,
including its catalog, inventory, customers, orders, purchases, suppliers,
costs, photos and WhatsApp configuration. Store members remain restricted to
the stores where they are members. This is an intentional product policy, not
an accidental bypass; see [ADR 0003](adr/0003-platform-super-admin-access.md).

## 7. Olivia storefront setup

Olivia is a regular Store OS store (slug `olivia`) with a richer public
storefront at `/catalogo/olivia`. There is no separate project or repo.

**Initial configuration:**

1. As super-admin, create a store named "Olivia" (the slug `olivia` is reserved
   globally; rename it later only via store settings, which re-publishes).
2. Transfer ownership to Fer: invite her by email from the store's settings.
   Once she accepts, she is a `member` with full catalog + storefront-content
   access. (Super-admin retains global operating access.) To make her the explicit `ownerUid`,
   an admin updates the store doc's `ownerUid` field in the Firebase console —
   owner vs. member only gates the settings/delete UI today.
3. Fer fills the storefront content in **Store settings → Editar sitio público**
   (hero, story, resale, FAQ, contact, SEO). Saving republishes `publicStores`.
4. Fer creates categories (Categorías tab) and products (Productos tab) with
   1–5 photos each. Published products appear at `/catalogo/olivia`.

**Migration (existing products):** automatic and idempotent. On load, the app
runs `migrateCatalog` — legacy `category` → a `Category`, legacy `imageUrl` → a
primary gallery image, `isPublic` → `status` — and marks `schemaVersion=1` so it
never re-runs. No data is duplicated. If a product predates this schema, simply
opening the app migrates it; cloud stores migrate on the next cloud sync.

**Security rules:** `firestore.rules` adds `categories/{id}` (membership-gated
like products) and `publicCatalogs/{slug}` (anonymous read, signed-in write).
Deploy with `npm run deploy:rules` (or `firebase deploy --only firestore,storage`).

**Storage:** gallery images live at `products/{storeId}/{productId}/{imgId}.jpg`,
optimized JPEG ≤1600px q80. The bucket stays in `us-east1` (free-tier region).
Confirm the §4b IAM grant is in place or photo writes fail with 403.

**Republish:** "Republicar catálogo" in store settings rebuilds all three public
projection collections (`publicStores`, `publicCatalogs`, `publicProducts`) and
prunes stale product docs. Use it after bulk edits or if the catalog looks stale.

**Rollback:** the storefront is pure projection of the private data; rolling
back means editing/archiving the products or unpublishing (set status to
`draft`). The public collections are rebuilt from private state, so they can
always be regenerated with "Republicar catálogo."

**Deep-link verification:** after deploying, open `/catalogo/olivia`,
`/catalogo/olivia/categoria/<slug>`, and `/catalogo/olivia/producto/<slug>`,
then **reload each** — the SPA rewrite in `vercel.json` (`/(.*)` → `/index.html`)
must serve the app on refresh, not a 404.

**Firestore consumption (free-tier budget):**

- A storefront visit = 2 reads (`publicStores` + `publicCatalogs`). Opening a
  product = +2 (`publicCatalogs` for storeId, `publicProducts` detail, plus
  `publicStores` for the header) — the catalog is cached in-app so navigation
  between products reuses it.
- Saving a product ≈ 3 writes (private product + catalog summary rebuild +
  detail doc); each photo = 1 Storage upload + 2 rule reads (`firestore.get()`
  in `storage.rules`).
- Free tier: 50K reads/day, 20K writes/day, 20K deletes/day, 1 GiB stored,
  10 GiB egress/month. Blaze charges overages — set budget alerts in the
  Firebase console. The public flow has **no persistent forms** (no writes from
  visitors), so anonymous traffic only consumes reads.
- Protected contact form / App Check / reCAPTCHA is **deferred** — they have
  limited free quota and can incur cost when exceeded, so they don't block this
  launch. Visitors contact via WhatsApp only.

**Out of scope for this MVP:** custom domains (Olivia lives at
`/catalogo/olivia`), per-product WhatsApp preview cards (need SSR), payments,
cart, customer accounts.

## Ambientes (dev vs prod)

Store OS runs on **two Firebase projects** so development/testing cannot touch
production data. The boundary between them is the Firebase project itself —
Auth UIDs, Firestore, and Storage are all per-project, and Security Rules have
no notion of "environment". Pointing each Vercel target at the right project is
what isolates Olivia's real data.

| Project | Firebase project id | Purpose | Who writes |
|---|---|---|---|
| Production | `store-os-f7cf8` | Olivia's real business | Only the platform super-admin (`admin@store.os`) and the tenant owners she invites |
| Development | `store-os-dev` | Dev/testing against realistic-but-fake data | Development only |

The local emulator (`store-os-demo` namespace, volatile) is a third target that
never touches either real project — see "Local development / testing" below.

### Vercel environment variables (per target)

Each Vercel target gets the **same six** `VITE_FIREBASE_*` variables, but with
the values of the matching project. **No variable may use the "All Environments"
scope** — that is the dominant risk: a Preview deploy inheriting prod's values
would write to Olivia's real data.

| Vercel target | Firebase project | `VITE_FIREBASE_PROJECT_ID` | `VITE_FIREBASE_EMULATOR` |
|---|---|---|---|
| **Production** | `store-os-f7cf8` | `store-os-f7cf8` | (unset) |
| **Preview** | `store-os-dev` | `store-os-dev` | (unset) |
| **Development** (local/`vercel dev`) | `store-os-dev` | `store-os-dev` | (unset) |

The remaining four (`API_KEY`, `AUTH_DOMAIN`, `STORAGE_BUCKET`, `SENDER_ID`,
`APP_ID`) take that project's Web App config values. Set each group scoped to
its target only.

### Build-time guard (`scripts/check-env.cjs`)

A build-time tripwire (defense-in-depth, **not** primary security) runs before
`tsc`/`vite` on every `npm run build`. It reads `VITE_VERCEL_ENV` (auto-injected
by Vercel) and `VITE_FIREBASE_PROJECT_ID`, and **aborts the build** (exit 1) on:

- `preview` + `store-os-f7cf8` (a Preview deploy pointing at prod), or
- `preview` + empty/missing project id (a mis-scoped variable), or
- `production` + anything other than `store-os-f7cf8`.

This catches the "All Environments" accident at build time. It is not primary
isolation — a determined actor with prod's public config can still instantiate
the SDK — that's by Firebase design (access is enforced by Security Rules).

### Create the `store-os-dev` project (one-time, console)

1. Firebase Console → Add project → `store-os-dev` → **do not** enable Google Analytics.
2. Firestore → Create database → **production mode** → a **US** region (e.g. `nam5`, same as prod). Immutable after creation.
3. Storage → Get started → bucket in **`us-east1`** (mandatory for the free tier; outside the three US regions Storage bills from the first byte).
4. Authentication → enable **Email/Password** and **Google**. **Never enable Phone** (SMS is the only Firebase service that charges from the first use — it breaks the zero-cost rule).
5. Project settings → Your apps → add a Web App → copy the six config values into the Vercel **Preview** + **Development** groups.
6. Set a **$0.01 budget alert** in Google Cloud Console → Billing → Budgets (notification only; it does not stop charges).
7. Apply the **IAM grant** `roles/datastore.user` to the Storage service agent of `store-os-dev` (same as §4b for prod), or product-photo uploads fail with 403.
8. Deploy the rules to dev: `firebase deploy --only firestore,storage --project dev` (the `dev` alias is in `.firebaserc`; rules are identical to prod — do not loosen them, or dev stops reflecting prod).

### Lock production (one-time, console)

1. Confirm `admin@store.os` is the **only** super-admin in prod (Firestore `users/` where `role == super_admin`). `firestore.rules` gates `super_admin` creation on the verified email `admin@store.os`, so no other signup can escalate even if `users/` were emptied.
2. Olivia is a **tenant owner** (a `member`/`owner` of her store), not a super-admin — she does not need to be in the allowlist.
3. **Restrict the prod API key** by HTTP referrer in Google Cloud Console → APIs & Services → Credentials → the prod API key → Application restrictions → HTTP referrers → add the Vercel prod domains (`*.vercel.app` of this project + any custom domain).
4. **Rotate** the prod key (it was briefly exposed early in the project): delete + recreate the prod Web App for a fresh `apiKey`/`appId`, update the Vercel **Production** env group, and re-auth.
5. Never delete the prod `users/` collection — if it empties, the bootstrap would otherwise re-run (mitigated by the allowlist, but the invariant is load-bearing).

### Isolation checklist (run after the first Preview + Production deploys)

- [ ] Register on the **Preview** URL → the user appears in `store-os-dev` Authentication, **not** in `store-os-f7cf8`.
- [ ] Create a store on Preview → it appears in `store-os-dev` Firestore, not prod.
- [ ] Upload a product photo on Preview → it lands in `store-os-dev` Storage, not prod.
- [ ] Preview build logs show `project: store-os-dev`; Production logs show `project: store-os-f7cf8`.
- [ ] No `VITE_FIREBASE_*` variable in Vercel has the "All Environments" scope.
- [ ] **Phone** sign-in is OFF in both projects; both Storage buckets are in `us-east1`; both have the IAM grant applied.

### Seed the dev project with test data (one-time + re-runnable)

`store-os-dev` starts empty. `scripts/seed-dev.cjs` populates it with a realistic
Olivia jewelry store (slug `olivia`) plus its categories, products, customers,
orders, and 1–2 sample product photos — so you can work against a populated dev
environment without touching Olivia's real production data. Idempotent (fixed ids
overwrite cleanly on re-run). **Dev-only by a load-bearing guard**: it aborts
unless the projectId is exactly `store-os-dev` (the Admin SDK bypasses Security
Rules, so this guard is the sole protection against a prod write).

1. Register `admin@store.os` **once** on the Preview URL (creates the user in
   `store-os-dev` Authentication). The seed looks up its uid to set
   `ownerUid`/`memberUids` on the store; if absent it aborts with a clear message.
2. Establish Application Default Credentials once (browser login, no password,
   no committed secret):
   ```
   gcloud auth application-default login
   ```
3. Run the seed:
   ```
   node scripts/seed-dev.cjs
   ```
4. Verify on the Preview: open `/catalogo/olivia` — the seeded public catalog
   should appear, and a product should show its uploaded sample image (confirming
   the dev Storage + IAM grant). `store-os-f7cf8` (prod) is untouched.

### If env vars got crossed (runbook)

If a Preview deploy ever wrote to prod (a mis-scoped variable): in the affected
project, delete the leaked data, then in **Google Cloud Console → Credentials**
revoke/restrict the prod API key, delete + recreate the prod Web App (new
`apiKey`/`appId`), update the correctly-scoped Vercel env group, and redeploy.
The build guard exists precisely so this is caught at build time, not after.

## Local development / testing

- **Demo mode (no backend):** `npm run dev` — runs fully on `localStorage` with
  seeded demo data.
- **With emulator:** `npm run emulators` (Auth + Firestore on localhost), then
  `npm run dev` with `VITE_FIREBASE_EMULATOR=true` in `.env`, or
  `npm run e2e:firebase` for the emulator test suite.

## Notes

- **Public catalog for cloud stores:** implemented. The app writes a public
  projection (`publicStores`/`publicProducts`) on store create/rename and on
  every product save, and `firestore.rules` allows anonymous read on those
  collections — so `/catalogo/:slug` works for both local demo and cloud
  stores. Owners get the public URL + "Copiar enlace" / "Compartir por
  WhatsApp" buttons in store settings, and "Republicar catálogo" to rebuild
  the projection on demand.
- **Member invites:** invitees who don't have an account yet receive a Firebase
  email sign-in link; once they sign up they're added to the store.
