# Olivia: catálogo editorial cálido

## Experience and boundaries

Warm ivory/rose editorial storefront, typographic opening, one searchable product grid,
category routes, featured/new/default-tier price ordering, inline photo galleries,
product details and the existing persisted WhatsApp order list. The named base price
tier is explicit in sorting options. No payment, automatic order creation, production
mutation, analytics or new dependency. Fer still confirms and registers the request.

Logo and seasonal desktop/mobile banners are independent. The banner preserves its
natural proportions and has no text overlay. With no assets, the typographic opening
remains. Mobile falls back to the desktop banner. Admin themes remain unchanged;
Olivia's palette, sizing, typography and motion live in the design system.

References: [Mejuri](https://mejuri.com/), [Missoma](https://www.missoma.com/collections/all),
[Baymard's product-list image research](https://baymard.com/blog/secondary-hover-information).
These inform the composition and interaction; they are not a promise of conversion lift.

## Content and editing

The existing site editor supports file selection, local previews, removal, mobile
banner and alternative text. Selecting a file does not upload or publish it. Saving
uploads unique filenames, persists the store and republishes its projection, then
removes previously managed assets no longer referenced by logo, banners or social image.
PNG logos retain transparency; banners become JPEG, max edge 1600px; logo max edge 600px.
Input accepts JPEG/PNG/WebP up to 10 MiB; processed assets must fit 500 KiB each.

A failed upload leaves the previous store intact. A failed/uncertain store write keeps
uploaded URLs for retry; a projection failure retains both old and new assets. This
intentionally favors valid images over deletion after an ambiguous write. Repeated
abandoned failures may leave orphaned files requiring later reconciliation. Cleanup
cannot target another bucket/store or an external/unmanaged URL.

Olivia's suggested copy describes only the selection and WhatsApp process. Existing
saved text is not overwritten automatically. Fer can load and review suggestions,
then save them; she should also review existing business-specific fields before launch.
No invented hours, shipping areas, materials, return policy or payment claims are seeded.

## Data and cost budget

- `StorefrontSection`: optional `mobileImageUrl` and `imageAlt`; existing `logoUrl` and
  `hero.imageUrl` reused. Empty strings explicitly clear image references across merge writes.
- Public product summaries: optional `images`, up to five `{url, alt}` entries, primary
  first; old `imageUrl` remains supported. Storage paths/private metadata are excluded.
- Catalog visit: two document reads. Internal category navigation: zero more reads.
  Detail navigation: one more document read while the catalog remains mounted. A direct
  detail visit requires three reads. Search, sort and card photo changes require no
  additional document reads. Only the selected full card image loads.
- Example budget, not measured production usage: 1,000 visits/month at 20 downloaded
  images each = 20,000 object downloads plus branding (up to two objects per page).
  At 500 KiB per new brand image, two brand assets × 1,000 cold visits is at most
  about 0.95 GiB. Existing product image sizes are unchanged and must be added separately.
- A three-image edit uses three uploads (each at most 500 KiB) plus cleanup deletes;
  Storage owner rules can consult two Firestore docs per evaluated authenticated write.
  Existing publication rewrites identity + catalog + published detail documents; it
  is not represented as a single cheap write. For 23 products this is 25 public writes,
  plus private store/control-plane writes and existing projection cleanup reads.
- These examples fit documented free quotas in isolation. Aggregate project usage is
  not available here, so this is not a guarantee that all traffic remains free. Keep
  the existing regional bucket and review actual usage before a public launch.
- The catalog still uses one document, with Firestore's 1 MiB limit. Five small image
  references add no per-product documents. Measure the actual public projection in
  Preview before launch; large catalogs may require a separate pagination change.

## Validation and rollout

Unit coverage: legacy/current projection, public-only photos, sorting/search, no duplicated
featured/new items, swipe/arrows, reuse of loaded data, cart and pricing regressions,
image staging, failed publication/retry, deletion and cross-store/bucket cleanup guards.
Browser coverage: 390px/1280px, overflow, gallery controls, keyboard modal focus, WhatsApp,
legacy documents, admin upload/public rendering and removal. Existing storage emulator
rules deliberately omit cross-service owner checks; production ownership rules are
unchanged and inspected directly, not claimed as exercised by the permissive emulator.

Local checks: typecheck, unit suite, build, 33 Firestore rules tests, 15 relevant browser
tests. CI additionally runs the repository's full browser/refresh pipeline before Preview.
The independent CLI reviewer was blocked by automatic approval review; manual code review
and executable gates were used instead.

Screenshots use synthetic emulator product/image fixtures, not Olivia's real inventory:

- [Mobile](../../screenshots/olivia-editorial/mobile.png)
- [Desktop](../../screenshots/olivia-editorial/desktop.png)
- [Editor](../../screenshots/olivia-editorial/editor.png)

Delivery: feature branch, atomic commits, draft PR, CI and Preview only. Existing public
projections gain galleries when an authorized operator saves/re-publishes. New code reads
legacy projections safely in the meantime. No automatic production republish or seed.
