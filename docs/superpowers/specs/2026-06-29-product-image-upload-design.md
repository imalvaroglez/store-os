# Product image upload — design (Store OS)

Date: 2026-06-29
Status: Approved (brainstorm)
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
| New-product upload | Product id pre-generated in the form so the path exists before first save |
| Storage read rule | Public (`allow read: if true`) — required by the anonymous catalog |
| Storage write rule | Auth-only + size (<5 MB) + `image/*` + fixed path shape |
| Write authority | Client writes (Approach A); Firestore `isMember` on the product doc remains the real authority |
| Demo access | Already strict (commit `bf5c10d` forces AuthScreen for signed-out visitors) |

## Strictness note (why public read is correct)

The owner asked for strict anonymous-avoidance. That strictness belongs to the
**app layer**, not Storage reads: a signed-out visitor cannot reach Store OS
(redirected to AuthScreen). But the **public catalog is anonymous by design** — a
customer opens `/catalogo/:slug` with no account, and the product `<img>` fetches
its Storage URL. That fetch *is* an anonymous Storage read. Making Storage reads
auth-only would 403 every catalog image for the very customers the catalog
serves. So: app access is strict (shipped), Storage **writes** are strict
(auth-only), Storage **reads** stay public because the catalog is public.

## Security caveat (Approach A)

Storage Security Rules cannot cheaply mirror Firestore `isMember` on the write
path. What we enforce: signed-in only, size/type limits, fixed path. What we
cannot enforce in rules alone: that the writer is a member of `storeId`.
Acceptable because a non-member can upload a stray image but **cannot** create the
`products/{id}` doc or the `publicProducts` projection that would ever display it
— both gated by `isMember` in `firestore.rules`. A stray upload is dead bytes,
never shown. The deterministic path also means writing another store's path only
overwrites an image the writer cannot reference.

`// ponytail: client writes can't enforce Firestore membership in rules; upgrade
// to a Callable Cloud Function that checks isMember(storeId) before accepting the
// upload if Storage abuse/quota ever becomes a real problem.`

## Architecture & file layout

Mirrors the existing `firestoreData.ts` (transport) + design-system (pure UI) +
form (orchestration) split.

| Unit | Role | Knows Storage? |
|------|------|----------------|
| `src/app/firebase/storage.ts` (new) | Transport: `resizeImageFile`, `uploadProductImage`, `deleteProductImage`. Pure async fns. | Yes — only place |
| `src/design-system/PhotoPicker.tsx` (new) | Preview tile + hidden file input + "Quitar foto". Callbacks hand `File \| undefined` up. | No (DS stays dep-free) |
| `src/features/catalog/ProductForm.tsx` (changed) | Cloud: render `PhotoPicker` instead of URL field; resize on pick, upload on submit. Demo: unchanged URL field. | Yes |
| `firestore.rules` | Unchanged | — |
| `storage.rules` (new) + `firebase.json` (+storage) | Public read, auth+size+type write at `products/{storeId}/{productId}.jpg` | — |

`Product.imageUrl` type is unchanged (`string | undefined`); the download URL is
stored there exactly as a pasted URL is today. The public projection needs no
change — it already carries `imageUrl` through.

## Data flow

**Pick (cloud):** tap tile → native picker → `PhotoPicker` hands the `File` up →
form calls `resizeImageFile` (local, cheap) → sets a local object-URL preview on
the tile (not yet uploaded).

**Submit (cloud):** form mints `crypto.randomUUID()` for new products (existing
reducer keys off `product.id`, so a pre-generated id works with `ADD_PRODUCT`);
if a file is staged, `uploadProductImage(storeId, productId, blob)` →
`getDownloadURL` → set `draft.imageUrl`; then the existing `submit()` persists
normally (Firestore + public projection, unchanged).

**Remove:** `PhotoPicker.onRemove` → clear staged file / clear `draft.imageUrl`.
The bucket object is only deleted when the **product** is deleted (deterministic
path means a re-add overwrites).

**Delete product:** provider's `deleteProduct` (cloud) additionally calls
`deleteProductImage(storeId, productId)`, best-effort (`.catch(() => {})`), same
pattern as existing projection/entity deletes.

**Demo mode:** zero Storage code runs; URL `TextField` unchanged. The form reads
`useStore().cloud` to decide which control to render.

## Error handling & edge cases

- **Resize fails** (corrupt/non-image): inline error under the tile, `imageUrl`
  unchanged, product never half-saved.
- **Upload fails** (network/quota/rules): same inline error, `imageUrl` unchanged;
  save still works (image optional); retry by re-picking.
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

## Testing (one check per non-trivial unit)

- `storage.test.ts`: `resizeImageFile` — feed a fake image File, assert output is
  JPEG and long edge ≤ 1024. (Upload/delete are thin SDK wrappers; covered by e2e.)
- `PhotoPicker`: presentational; no unit test. Verified by the gate.
- Emulator e2e (`e2e/firebase.spec.ts`): signed in → create product with a photo →
  assert `imageUrl` is a Storage emulator URL and the `<img>` renders → delete the
  product → assert the bucket object is gone. Exercises resize→upload→project→
  public-load→delete against `:9199`.

## Out of scope

Customer/store-logo upload, backend thumbnails (Cloud Function), multi-size
images, Function-gated membership-checked writes (documented upgrade path),
image cropping/rotation UI.
