# Firebase foundation — design (Store OS)

Date: 2026-06-27
Status: Approved (brainstorm)
Sub-project: 1 of 3 (auth + Firestore + roles). Pure-engineering; the Netflix
picker and role-gated UI are later sub-projects built on top.

## Context

Store OS is local-first today (`localStorage`, no auth). The owner wants real
authentication, cloud data, and a role model (super-admin + per-store members),
with a Netflix-style picker and role-gated UI to follow. This sub-project is the
**engine**: auth, Firestore data, security rules, and the cloud-backed data layer.
The visible UX (picker, owner/admin split) comes after.

## Decisions (brainstorm)

| Area | Decision |
|------|----------|
| Backend | Firebase (Auth + Firestore + Security Rules) |
| Auth | Email/password + Google; first signup → super-admin |
| Roles | super-admin (all stores) + per-store members |
| Data layout | Root collections + membership fields |
| Membership | Admin invites members by email; no open join |
| Local vs cloud | Signed-out = current local demo (untouched); signed-in = cloud truth |
| First cloud login | Seed demo stores (Santi + Joyería) into Firestore |
| Verification | Build against **Firebase Emulator** for local e2e; real project later |

## Data model (Firestore, root collections)

- `users/{uid}` → `{ email, role: "super_admin" | "member", displayName?, createdAt }`
- `stores/{id}` → existing `Store` + `ownerUid`, `memberUids: string[]`
- `products/{id}` → existing `Product` (+ `storeId` already present)
- `customers/{id}` → existing `Customer` (+ `storeId`)
- `orders/{id}` → existing `Order` (+ `storeId`)

Server-time `createdAt`/`updatedAt` via `serverTimestamp()` where useful.

## Security rules (server-enforced)

```
super_admin := exists(/users/$(request.auth.uid)) && get(/users/$(request.auth.uid)).data.role == "super_admin"
isMember(storeId) := get(/stores/$(storeId)).data.memberUids.hasAny([request.auth.uid]) || super_admin
```

- `users/{uid}`: a user can read/write own doc; super-admin can read all; only
  super-admin can set `role == "super_admin"` (bootstrap: first-user rule below).
- `stores/{id}`: read/write iff `isMember(id)`.
- `products|customers|orders`: read/write iff the entity's `storeId` resolves to a
  store where `isMember(storeId)`.
- **Bootstrap:** `create` on `users/{uid}` is allowed if it's the caller's own uid
  AND no `users` doc with `role == "super_admin"` exists yet (first signup becomes
  admin). Subsequent signups create `role == "member"`.

## Auth + space model

- `AuthGate` wraps the app. Signed-out → existing local app (unchanged, demo seed).
  Signed-in → cloud-backed app.
- On first cloud sign-in with empty cloud, seed Santi + Joyería into Firestore
  (reuse `buildSeedState`, owned by the new user).
- Sign-out returns to the local demo.

## Architecture change

`StoreProvider` keeps its `useReducer` + actions + UI shape. The **persistence
adapter** swaps: `localStorage` when signed-out, **Firestore (async)** when
signed-in. Writes dispatch optimistically; an async adapter subscribes to
Firestore `onSnapshot` per collection and reconciles. The reducer stays the single
source for the React tree; Firestore is the durable source synced in.

New code lives under `src/app/firebase/` (config, auth wrapper, firestore adapter,
rules as `firestore.rules`). Emulator wiring under `e2e/` + a firebase.json.

## Scope of THIS cut

Auth (signup/in/out + Google), `users` doc, first-user super-admin bootstrap,
member invite by email, cloud read/write of all entities, security rules, the
signed-out/local vs signed-in/cloud split — all verified locally against the
**Firebase Emulator** with Playwright e2e.

## Out of scope / known limitations

- Netflix picker + role-gated UI → next sub-project.
- **Public catalog for cloud stores**: Firestore rules hide products from
  non-members, so `/catalogo/:slug` works only for local demo stores until a
  public-read path is added. Deferred; noted.
- Real Google OAuth needs a real project + client ID; emulator supports email/password
  fully, Google is wired but verified live later.
- No password reset / email verification in this cut.

## Verification

- Emulator suite (Auth + Firestore) via `firebase emulators:start --only auth,firestore`.
- Playwright e2e (`e2e/firebase.spec.ts`): start emulator, sign up (first = admin),
  verify `users` doc + role, create a store (cloud write), sign out → back to demo,
  sign up second user → member (no stores visible until invited).
- `npm run test` (unit) green; `npm run build` green; gate still green.
