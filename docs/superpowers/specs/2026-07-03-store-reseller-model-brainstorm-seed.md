# Store reseller model — brainstorm seed (Store OS)

Date: 2026-07-03
Status: **Seed for a future brainstorming session — NOT an approved design.**
Owner: Álvaro (super-admin / platform owner)

> This document captures the product direction so it is not lost between
> sessions. It is the starting input for a dedicated brainstorming session,
> not a spec. When that session happens, run the normal brainstorm → spec →
> plan → implement flow and supersede this file with a real design doc.

## The goal (in the owner's words)

The original idea of Store OS is for the owner (super-admin) to **sell stores
to third parties**. Someone who wants to sell something comes to the owner,
the owner provisions a store for them, and that person administers their own
store end-to-end. The owner needs a way to **administer everything that
entails**: the stores he has sold, their state, their customers, etc.

## What already exists (the foundation to build on)

The multi-tenant engine is already in place — this is not greenfield:

- **Roles:** `super_admin` (the owner) vs `member` (a store owner / staff).
  First signup bootstraps `super_admin`; everyone else is `member`.
  See `src/app/firebase/auth.ts`.
- **Per-store membership:** `Store.ownerUid`, `Store.memberUids`,
  `Store.pendingInvites`. Membership enforced server-side in
  `firestore.rules` (`isMember(storeId)`).
- **Invite flow:** owner invites members by email (email-link auth).
- **Public storefront path already works in cloud:** anonymous-readable
  projections `publicStores/{slug}`, `publicProducts/{id}`, `slugs/{slug}`
  (slug reservation as a lock). The "public catalog for cloud stores" item
  that used to be out of scope is partially unblocked.
- **Data isolation** via selectors + scoped Firestore queries
  (`firestoreData.ts`).
- **Three visual themes**, image upload, the full store/product/order/customer
  CRUD.

So the "create a store and hand it to an owner" primitive already works. What
is missing is the **business layer on top**.

## What is missing (the open questions for the brainstorm)

These are the questions a future brainstorming session must resolve. They are
NOT decisions yet — just the map of unknowns:

1. **Plans / tiers.** Is there a notion of a plan per store (Free / Pro / …)?
   What limits does each plan impose? Candidate limits governed by the
   zero-cost constraint: # stores per owner, # products, # images, # orders,
   # members. Any limit here also doubles as a **free-tier guardrail** for us.
2. **Billing.** Does the owner charge store owners? If so, how — manual
   (cash/transfer, off-platform), or integrated (Stripe / MercadoPago)? This
   is the single biggest cost/complexity driver and the biggest legal/tax
   surface. The zero-cost constraint (CLAUDE.md) makes an integrated payment
   gateway non-trivial — every gateway is a new billing surface.
3. **Onboarding / self-service.** Can a third party sign up and provision
   their own store, or must the owner provision every store manually? Today
   it is manual (owner creates, invites). Self-service is a much bigger build
   (public signup flow, plan selection, payment, automated provisioning).
4. **Admin console for the owner.** A "platform owner" view: list of all
   stores sold, per-store status (active / suspended / unpaid), owner contact,
   plan, usage vs limits, MRR-ish rollup. This is the "administrar todo lo
   que corresponde" the owner described.
5. **Suspend / revoke.** When a store owner stops paying or violates terms,
   can the owner suspend a store (read-only) or revoke it? Requires a store
   status field + rules that deny writes when suspended.
6. **White-label / branding per store.** Does each sold store get its own
   name/logo/colors, or do they all live under Store OS branding? The theme
   system already supports per-user themes; per-store branding is a step
   further.
7. **Public catalog for sold stores.** Each sold store presumably wants its
   own shareable `/catalogo/:slug`. The anonymous-read path exists; what is
   missing is exposing it per store and maybe a custom domain / vanity slug.

## Constraints that govern all of the above

- **🔴 Zero-cost is a hard constraint** (CLAUDE.md). The project is on Blaze
  only because Cloud Storage requires it; nothing may generate charges.
  Billing integration, if pursued, must keep the platform itself in the free
  tier — the gateway's fees are the store owner's problem, not ours, but the
  integration code and any Cloud Functions it needs must stay within quota.
- **Spanish (MX) UI; English code.** Any owner-facing or store-owner-facing
  copy is in Spanish.
- **YAGNI / ponytail.** The simplest model that lets the owner sell and
  administer stores wins. Manual billing + manual provisioning is a valid
  first cut; do not assume integrated payments.

## Likely decomposition (sub-projects)

A future brainstorm will probably split this into independent sub-projects,
each its own spec → plan → implement cycle:

1. **Store status + owner admin console** — add `Store.status`
   (`active` / `suspended`), a platform-owner-only screen listing all stores
   with status/owner/plan(placeholder)/usage. Lowest cost, highest value.
   No billing.
2. **Plans + limits** — a `Plan` concept and per-store limits enforced in
   rules + client. Doubles as free-tier guardrails.
3. **Per-store public catalog exposure** — make the existing anonymous-read
   path first-class for sold stores (vanity slug, shareable link).
4. **Billing** (only if/when needed) — manual first, integrated later.
5. **Self-service onboarding** (only if/when needed) — biggest build, defer.

## Next action

When ready, open a brainstorming session scoped to **sub-project 1 (store
status + owner admin console)** — it is the smallest unit that delivers the
"administrar las tiendas que vendí" core and unblocks the rest. Use this file
as the input.
