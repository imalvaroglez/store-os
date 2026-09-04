# Product image upload — design (Store OS)

Date: 2026-06-29
Status: Approved (brainstorm) — **shipped & verified against real Firebase 2026-07-03** (see "Production verification" addendum at the end).
Sub-project: first item off the out-of-scope list. Adds real photo upload to
products via Firebase Storage, replacing the paste-a-URL field.

## Context

Today a product's photo is a free-text URL (`Product.imageUrl?: string`, set via
a `TextField` in `ProductForm` whose hint says *"Sin subida de archivos por
ahora"*). CLAUDE.md lists image upload as out of scope; this sub-project brings
it in for **cloud mode only**. Firebase Storage is not yet wired: `storageBucket`
exists in `config.ts` / `.env.example` but is unused, no Storage SDK is imported,
`firebase.json` has no storage block, and there is no `storage.rules`.

The photo is read in two places — `CatalogScreen` (admin) and `PublicCatalogScreen`
(anonymous public catalog) — and is mirrored into the `publicProducts` projection
(`firestoreData.ts`), so uploaded images **must be publicly readable** for the
anonymous catalog to load them.

## Decisions (brainstorm)

| Area | Decision |
|------|----------|
| Scope | Product photos only (no customer/store-logo upload this round) |
| Demo/local mode | Unchanged — keep the URL `TextField`. Storage runs only in cloud mode. |
| Sizing | Client-side resize: canvas, long edge ≤ 1024px, JPEG q≈0.8 → ~80–150 KB |
| Orphan cleanup | Deterministic path `products/{storeId}/{productId}.jpg` (replace overwrites); delete object when product is deleted |
| Picker UX | Preview tile + native `<input type="file" accept="image/*">` + "Quitar foto" |
| URL field in cloud | Replaced by the picker (one obvious way) |
| Upload timing | **On submit**, not on pick — avoids orphan-on-cancel |
| New-product upload | Reuse the **already** pre-generated `product.id` (`newProduct` mints `uid("prod")` at `StoreProvider.tsx:320`, passed in by `CatalogScreen`); never mint an id in the form |
| Storage read rule | Public (`allow read: if true`) — required by the anonymous catalog |
| Storage write/delete rule | `super_admin` OR store membership, verified in the rule via `firestore.get()`; size/type on `create, update`; separate `delete` |
| Filename rule | `match /products/{storeId}/{fileName}` with `fileName.matches('.*\\.jpg')` (don't bet on `{productId}.jpg` partial capture) |
| Development bucket | The real `store-os-dev` Storage bucket, selected by the environment contract |
| Demo access | Already strict (commit `bf5c10d` forces AuthScreen for signed-out visitors) |

## Strictness note (why public read is correct)

The owner asked for strict anonymous-avoidance. That strictness belongs to the
**app layer**, not Storage reads: a signed-out visitor cannot reach Store OS
(redirected to AuthScreen). But the **public catalog is anonymous by design** — a
customer opens `/catalogo/:slug` with no account, and the product `<img>` fetches
its Storage URL. That fetch *is* an anonymous Storage read. Making Storage reads
auth-only would 403 every catalog image for the very customers the catalog
serves. So: app access is strict (shipped), Storage **writes** are strict
(membership-checked), Storage **reads** stay public because the catalog is public.

## Security model

Storage Security Rules **can** read Firestore via `firestore.get()` /
`firestore.exists()` (cross-service rules), so writes/deletes mirror the same
`super_admin`-or-member authority as Firestore `isMember` — closing the
cross-store overwrite hole. Reads stay public (the anonymous catalog needs them).

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    function isStoreMember(storeId) {
      return request.auth != null && (
        firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.role == 'super_admin'
        || firestore.get(/databases/(default)/documents/stores/$(storeId)).data.memberUids.hasAny([request.auth.uid])
      );
    }
    match /products/{storeId}/{fileName} {
      allow read: if true;
      allow create, update: if isStoreMember(storeId)
        && request.resource.size < 5 * 1024 * 1024
        && request.resource.contentType.matches('image/')
        && fileName.matches('.*\\.jpg');
      allow delete: if isStoreMember(storeId);
    }
  }
}
```

`isStoreMember` does two Firestore reads per write — acceptable for a low-volume
write path. Caveat: Storage cross-service rules support only the **`(default)`**
Firestore database; the app uses the default DB, so fine. Size/type validation
lives on `create, update` only (not `delete`). The client writes the deterministic
path `products/{storeId}/{productId}.jpg`; the `{fileName}` wildcard keeps the
rule robust regardless of capture syntax.

## Architecture & file layout

Mirrors the existing `firestoreData.ts` (transport) + design-system (pure UI) +
form (orchestration) split.

| Unit | Role | Knows Storage? |
|------|------|----------------|
| `src/app/firebase/storage.ts` (new) | Transport: `resizeImageFile`, `uploadProductImage`, `deleteProductImage`. Pure async fns. | Yes — only place |
| `src/design-system/PhotoPicker.tsx` (new) | Preview tile + hidden file input + "Quitar foto". Callbacks hand `File \| undefined` up. | No (DS stays dep-free) |
| `src/features/catalog/ProductForm.tsx` (changed) | Cloud: render `PhotoPicker` instead of URL field; resize on pick, upload on submit. Demo: unchanged URL field. | Yes |
| `firestore.rules` | Unchanged | — |
| `storage.rules` (new) + `firebase.json` (+storage, +:9199) | Public read; Firestore-backed membership write/delete; size/type on create/update | — |

`Product.imageUrl` type is unchanged (`string | undefined`); the download URL is
stored there exactly as a pasted URL is today. The public projection needs no
change — it already carries `imageUrl` through.

## Data flow

**Pick (cloud):** tap tile → native picker → `PhotoPicker` hands the `File` up →
form calls `resizeImageFile` (local, cheap) → sets a local object-URL preview on
the tile (not yet uploaded).

**Submit (cloud):** the form already has `product.id` (pre-generated by
`newProduct`, passed in by `CatalogScreen`) — **reuse it, never mint**. If a file
is staged, `await uploadProductImage(storeId, productId, blob)` →
`getDownloadURL` → set `draft.imageUrl`; then the existing `submit()` persists
normally (Firestore + public projection, unchanged).

**Remove:** `PhotoPicker.onRemove` → clear staged file / clear `draft.imageUrl`.
The bucket object is only deleted when the **product** is deleted (deterministic
path means a re-add overwrites).

**Delete product:** `deleteProduct(productId)` looks the product up in
`state.products` for `storeId` **before** dispatch, then (cloud, best-effort
`.catch(() => {})`) calls `deleteProductImage(storeId, productId)` alongside the
existing `deleteEntity`/`removePublicProduct`. Note: there is **no product-delete
UI today** (`deleteProduct` is API-only), so this is a provider hook verified by
code review, not by e2e.

**Demo mode:** zero Storage code runs; URL `TextField` unchanged. The form reads
`useStore().cloud` to decide which control to render.

## Error handling & edge cases

- **Resize fails** (corrupt/non-image): inline error under the tile, `imageUrl`
  unchanged, product never half-saved.
- **Upload fails** (network/quota/rules) **while a file is staged:** block the
  save — show the inline error, keep the form open, re-enable the button. The
  user must either retry the upload or remove the staged file; they cannot save a
  half-uploaded state. **Saving with no staged file** still works (image is
  optional); the existing `imageUrl` (e.g. from an earlier upload) is preserved.
- **Delete-image fails:** swallowed (best-effort); dead object is harmless.
- **Remove photo + save:** `imageUrl` cleared → projection writes `null` → public
  catalog shows the 🛍️ fallback. Stale bucket object remains until product delete.
- **Cancel after picking:** no orphan — upload is deferred to submit.
- **Replace before save:** only the last staged file uploads.
- **Content-type spoof:** `<img>` decode fails in resize → caught; `image/` rule
  is the second line.

## Design-system gate (resolved in plan)

The hidden file control is a raw `<input>`. The gate (`design-system-gate.test`)
fails if `src/features/**`/`src/app/**` use raw `<input>` (exempts only
`ErrorBoundary` today). Resolution: `PhotoPicker` lives in `src/design-system/`
and the hidden input is internal to it (the gate scans feature/app code, not the
DS itself) — so no new exemption is needed. The plan confirms this against the
actual gate regex.

## Testing

Vitest is node-default here (the gate uses `node:fs`), so there's no DOM/canvas in
unit tests. Resize is DOM-only, so it's verified in Playwright, not Vitest.

- `resizeImageFile`: **no Vitest unit test.** Verified end-to-end by e2e.
- `PhotoPicker`: presentational; no unit test. Verified by the design-system gate.
- Emulator e2e (`e2e/firebase.spec.ts`): signed in → (create a store if landed as
  a member) → open catalog → attach a **>1024px image** generated at runtime via
  canvas and fed through `setInputFiles` on the hidden input → save → assert the
  `<img>` src is a Storage-emulator URL. A >1024px image actually exercises the
  downscale; a 1×1 would only prove upload/render.
- **No "delete product → object gone" e2e step** — there is no product-delete UI,
  so it's infeasible against current UI. Image cleanup on delete is covered by the
  provider hook (code-reviewed), and the deterministic path means replaces never
  orphan.

## Emulator wiring

Auth + Firestore are wired today; Storage joins them:
- `firebase.json`: `"storage": { "rules": "storage.rules" }` + under `emulators`
  `"storage": { "port": 9199 }`.
- `package.json` `emulators` / `deploy:rules` scripts include storage;
  `e2e:firebase` runs via `scripts/e2e-firebase.sh` (see below).
- `playwright.firebase.config.ts`: comment only — the app already routes via
  `VITE_FIREBASE_EMULATOR=true`; Storage uses `connectStorageEmulator`
  (Web-SDK-side), **not** `FIREBASE_STORAGE_EMULATOR_HOST` (Admin-SDK-side).
- `e2e/firebase-global-setup.ts`: Storage is intentionally **not** wiped — the
  emulator has no bulk-reset endpoint, and `emulators:exec` starts a fresh
  instance each run, so Storage starts empty deterministically.
- The development bucket is **explicit** (`store-os-dev`), not derived from an
  empty `.env`, mirroring the environment guard in `config.ts`.

### Emulator rules limitation + swap script (verified during implementation)

The Storage emulator **cannot evaluate the production rules**:
1. Cross-service `firestore.get()` is unsupported → the membership check 403s
   every write.
2. `request.resource.contentType.matches('image/')` is also unreliable in the
   emulator (always denies). `request.resource.size` and `request.auth` do work.

Production `storage.rules` keeps **all** guards (membership + size + contentType +
fileName) — production evaluates them correctly. For the e2e only, a separate
`storage.rules.emulator` (auth + size cap) lets the flow run. `scripts/e2e-firebase.sh`
swaps it in, runs the suite, and **always restores** the strict `storage.rules`
via a trap — so the repo never ships weak rules. Membership + contentType
enforcement is verified by review of `storage.rules`, not by the emulator.

Note: `firebase --config <alt>.json emulators:exec` does **not** reliably override
the storage rules path — hence the file-swap approach instead of an alternate
config.

## Out of scope

Customer/store-logo upload, backend thumbnails (Cloud Function), multi-size
images, a product-delete UI, named-DB cross-service rules, image cropping/rotation.

---

## Production verification addendum (2026-07-03)

Verified against the **real** `store-os-f7cf8` backend (dev → Firebase prod,
no emulator). Four issues surfaced that the emulator e2e could not catch, all
fixed:

1. **Cross-service `firestore.get()` needs an IAM grant.** `storage.rules`
   verifies membership via `firestore.get(/databases/(default)/documents/...)`.
   In a fresh Blaze project this fails with `storage/unauthorized` (403) for
   EVERY upload, even the super-admin owner, because the Cloud Storage service
   agent can't read Firestore. Fix: one-time
   `roles/datastore.user` grant to `service-<projectNumber>@gcp-sa-firebasestorage.iam.gserviceaccount.com`
   (documented in `docs/DEPLOYMENT.md` §4b). No cost — it's a permission; the
   reads count against the normal Firestore free quota (2/upload). The emulator
   never reproduced this because it can't evaluate `firestore.get()`.

2. **`VITE_FIREBASE_EMULATOR` truthy bug.** `!!import.meta.env.VITE_FIREBASE_EMULATOR`
   treated the string `"false"` as truthy, so dev silently ran against the
   emulator even with `.env` saying `false`. Fixed by string-comparing to
   `"true"` in `config.ts` and `storage.ts`. (Production builds were saved by
   the `MODE !== "production"` guard, but the boolean bug was a latent footgun.)

3. **`setDoc` rejected `undefined` fields.** Tiered stores carry `price: undefined`
   (flat stores `prices: undefined`). Firestore rejects `undefined` field values,
   so `saveEntity` threw and **no fields persisted** — not just `imageUrl`, the
   entire product write. This is why a photo appeared in-session (local state)
   but vanished on reload (never reached Firestore). Fixed by stripping `undefined`
   keys in `saveEntity` (one guard for every entity/call site).

4. **Seed race produced duplicate entities.** `seedCloudIfEmpty` can double-fire
   (StrictMode / auth flicker); two runs both saw an empty project and both
   wrote, and random `uid()` ids duplicated every product/customer/order.
   Fixed by making `buildSeedState()` ids **deterministic** (`prod_joyeria_1`,
   etc.) so a second run overwrites the same docs instead of duplicating.

Also shipped the review fixes: EXIF orientation (`createImageBitmap({ imageOrientation: 'from-image' })`),
exact contentType allowlist in `storage.rules` (was a broad `image/` prefix that
admitted `image/svg+xml`), and orphan cleanup on remove-photo + delete-store.
