# Force AuthScreen in production (no demo on the deployed app)

**Date:** 2026-06-28
**Status:** Approved (approach A)
**Branch:** `feat/firebase-foundation`

## Problem

A visitor opening the production URL (`https://store-os-alpha.vercel.app`) with no
session lands directly in **local-demo mode** — the seeded store "Joyería" — and never
sees the login/registration screen. There is no visible path into the cloud app.

This is by design for **dev** (`CLAUDE.md`: "Modo demo local (sin sesión) intacto"), but
it is wrong for a deployed SaaS: a new visitor should sign up/sign in first.

Confirmed non-causes (verified on the deployed bundle):
- Firebase config **does** reach the bundle (`AIzaSy…` and `store-os-f7cf8` are present
  in the served JS).
- `isFirebaseConfigured()` returns `true` in production, `VITE_FIREBASE_EMULATOR` is unset.

Root cause is routing, not config: `App.tsx` `Root()` renders `<StoresScreen/>` (demo)
whenever there is no session and no active store, regardless of environment.

## Goal

In a **built** deployment (preview or production), a signed-out visitor with no active
store sees the **`AuthScreen`** instead of the demo. In **dev** (`npm run dev`) and under
**tests**, the current demo behavior is preserved unchanged.

## Approach (chosen: A — gate on `import.meta.env.DEV`)

The demo is treated as a **dev-only affordance**. The signal is Vite's built-in
`import.meta.env.DEV`, which is:

| Context | `DEV` | `PROD` | `MODE` | Result |
|---|---|---|---|---|
| `npm run dev` | `true` | `false` | `development` | demo preserved |
| Vitest (verified) | `true` | `false` | `test` | demo preserved |
| `npm run build` / deployed | `false` | `true` | `production` | **AuthScreen forced** |

Rejected alternatives:
- **B — `location.hostname === 'localhost'`**: string check; breaks for `vite preview`
  and `127.0.0.1`. More fragile than a build-mode flag.
- **C — new `VITE_DEMO_MODE` flag**: adds a knob for a binary `DEV` already encodes.
  YAGNI.

## Change

**File:** `src/app/App.tsx`, in `Root()`.

Today the signed-out fallback (line 28–35) is:

```tsx
// Signed out (local demo) with no active store -> local create-first screen.
if (!activeStore) {
  return (
    <div className="min-h-full">
      <StoresScreen />
    </div>
  );
}
```

Becomes: in non-DEV builds with no session, render `AuthScreen` full-screen; otherwise
keep the demo `StoresScreen` exactly as-is.

```tsx
// Signed out with no active store. In a built deployment (DEV=false), a visitor
// must authenticate before anything else — no demo on the public app. In dev/tests
// (DEV=true) keep the local create-first demo screen.
if (!activeStore) {
  if (!import.meta.env.DEV) {
    return <AuthScreen />;
  }
  return (
    <div className="min-h-full">
      <StoresScreen />
    </div>
  );
}
```

`AuthScreen` is imported from `./firebase/AuthScreen` (already used as a modal in
`AppShell.tsx:169`). Rendered full-screen here it drives its own `signUp`/`signIn`;
on success `user` becomes set and `Root` re-renders into the signed-in branch
(picker / stores).

### AuthScreen full-screen readiness

`AuthScreen` is currently used as a modal triggered from `AppShell`. Rendering it
standalone (no shell, full viewport) must look correct: it should occupy the screen and
be centered/scrollable on mobile. The implementation step will verify this visually and
adjust the wrapper only if needed (e.g. wrap in `min-h-full`). No behavior change to
`AuthScreen` itself is expected.

## What does NOT change

- `config.ts`, `AuthProvider.tsx`, `auth.ts`, `firestoreData.ts` — untouched.
- The signed-in branches of `Root` (picker / stores / shell) — untouched.
- Dev demo behavior and `npm run dev` workflow — untouched.
- Existing tests — untouched in behavior (see below).

## Testing

Existing `src/app/App.test.tsx` renders `HomeScreen` / `PublicCatalogScreen` directly
with seeded state and an active store; it does **not** exercise `Root()`'s signed-out
fallback. Because Vitest reports `DEV=true`, even a future `Root` test would see the demo
path, so the existing suite is unaffected.

New minimal check (per project convention "toda lógica no trivial deja un test pequeño"):
a `Root`-level test asserting the **non-DEV** path renders `AuthScreen` and not the demo.
Since `DEV` is `true` under Vitest by default, the test stubs
`import.meta.env.DEV = false` (and restores it) and renders `<App/>` with no session,
asserting `AuthScreen` content is present and demo store content ("Joyería") is absent.

## Out of scope

- Changing `AuthScreen`'s design/layout beyond what full-screen rendering requires.
- Public catalog for cloud stores (tracked separately — implemented after this plan).
- Any auth method enablement (Email/Password + Google already enabled in the console).

## Verification

- `npm run typecheck && npm run test && npm run build` all pass.
- Redeploy (`vercel --prod`); open the URL in a clean browser (no session) → `AuthScreen`
  appears, not the demo. Sign up → lands in the picker/stores (cloud).
- `npm run dev` still shows the demo directly (DEV=true).
