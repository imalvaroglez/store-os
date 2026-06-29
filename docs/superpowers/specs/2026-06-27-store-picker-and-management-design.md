# Store picker + management — design (Store OS)

Date: 2026-06-27
Status: Approved (brainstorm)
Sub-project: 2 of 3. Builds on the Firebase foundation (sub-project 1).

## Context

The foundation shipped auth + cloud stores + membership, but there's no visible
"who's watching" moment and stores can't be fully managed after creation. This
sub-project adds the **Netflix-style picker** and **full store management**
(rename / change type / WhatsApp / members / delete).

## Decisions (brainstorm)

| Area | Decision |
|------|----------|
| Picker entry | Shows right after sign-in; "Cambiar tienda" (sidebar/header) returns to it |
| Picker layout | C — compact list rows (avatar + name + type), scales to many stores |
| Store management | Full: rename, change type, WhatsApp, members (invite/remove), delete |
| Type change | Changeable after creation; UI adapts (existing product data preserved) |
| Member invite | By email; if no account, store a pending invite + send a sign-in link |

## Picker

Full-screen `StorePickerScreen`: "¿Quién opera hoy?" heading, list rows
(avatar = first initial, name, type label), a "+ Nueva tienda" row, and a small
"administrador" tag for the super_admin. Selecting a row sets `activeStoreId`
and exits to the app shell. A "Cambiar tienda" button in the sidebar (desktop) /
header (mobile) returns to it.

Shown when signed in AND (`activeStoreId` is null OR user explicitly chose to
switch). Picking a store persists `activeStoreId`.

## Store settings

`StoreSettingsScreen` (sheet or route) for the active store:
- Nombre (rename), Tipo (toggle Bajo pedido / Inventario y precios), WhatsApp.
- Miembros: list current members (email); invite by email (lookup uid via
  `findUidByEmail`; if found, add to `memberUids`; else store a pending invite on
  `stores/{id}.pendingInvites: string[]` and send a Firebase email sign-in link
  scoped to land as a member of this store). Remove member.
- Eliminar tienda (confirm) — deletes store + its products/customers/orders.

## Backend additions

- `StoreProvider`: expose `updateStore`, `deleteStore`, `inviteMember`,
  `removeMember`. Cloud path writes-through to Firestore; rules allow
  owner/super_admin to update store (incl. memberUids).
- `firestore.rules`: allow store `update` to modify `memberUids`/`pendingInvites`
  by owner or super_admin.
- New field on store docs: `pendingInvites: string[]` (emails awaiting signup).

## Scope / out of scope

- In scope: picker, full CRUD on stores, type change, member invite (email + link),
  "Cambiar tienda".
- Out of scope: role-gated UI polish (sub-project 3), public-catalog public-read
  path, request-to-join flow, per-store theme (themes stay per-user).

## Verification

- Emulator e2e: sign in (admin) → picker shows → pick store → enter → "Cambiar
  tienda" → back to picker → create store → edit (rename/type) → invite member →
  delete store. Plus the existing 3 foundation tests stay green.
- typecheck/test/build/gate green.
