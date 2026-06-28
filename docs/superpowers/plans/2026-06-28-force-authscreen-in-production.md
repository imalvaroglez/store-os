# Force AuthScreen in Production — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a built (production/preview) deployment, a signed-out visitor with no active store sees `AuthScreen` instead of the local demo; dev and tests keep the current demo behavior.

**Architecture:** Gate the signed-out fallback in `App.tsx` `Root()` on `import.meta.env.DEV` (Vite build-mode flag). `DEV` is `true` in `npm run dev` and under Vitest, `false` only in built deployments — so the demo path is preserved everywhere except the deployed app. No changes to config, providers, or auth logic.

**Tech Stack:** React 18, TypeScript, Vite (`import.meta.env`), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-28-force-authscreen-in-production-design.md`

---

## File Structure

- **Modify:** `src/app/App.tsx` — add the `!import.meta.env.DEV` branch in `Root()`'s signed-out fallback, rendering `AuthScreen` in a full-height centered wrapper. Add the `AuthScreen` import.
- **Test:** `src/app/App.test.tsx` — add a `Root`-level test that stubs `import.meta.env.DEV = false`, renders `<App/>` with no session, and asserts `AuthScreen` shows and the demo store does not.

No new files. No other files touched.

### Reference: current `Root()` fallback (App.tsx:28-35)

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

### Reference: `AuthScreen` signature (firebase/AuthScreen.tsx:7)

```tsx
export function AuthScreen({ onDone }: { onDone?: () => void })
```

`onDone` is optional. In `App.tsx` we render it **without** `onDone`: after a successful
sign-in, `AuthProvider` sets `user`, `Root()` re-renders, and the signed-in branch
(picker/stores) takes over — `onDone` is not needed.

`AuthScreen`'s root element is `<div className="space-y-4">` (no viewport wrapper). To
render it full-screen it must be wrapped in a full-height, centered, scroll container —
mirroring how the demo `StoresScreen` is wrapped in `<div className="min-h-full">`.

---

## Task 1: Failing test — non-DEV signed-out renders AuthScreen

**Files:**
- Test: `src/app/App.test.tsx` (add a `describe` block at the end of the file)

- [ ] **Step 1: Write the failing test**

Append this block to `src/app/App.test.tsx` (after the existing `HomeScreen store isolation render` describe block, before EOF):

```tsx
describe("Root signed-out routing (production)", () => {
  it("shows AuthScreen, not the demo, when DEV is false and there is no session", () => {
    const original = import.meta.env.DEV;
    (import.meta.env as { DEV: boolean }).DEV = false;
    try {
      // No seed state, no session -> in a built deployment this must be AuthScreen.
      render(<App />);
      // AuthScreen renders its header (Entrar / Crear cuenta) and a subtitle.
      expect(screen.getByText("Sincroniza tus tiendas en la nube")).toBeTruthy();
      // The demo store must NOT appear.
      expect(screen.queryByText("Joyería")).toBeNull();
    } finally {
      (import.meta.env as { DEV: boolean }).DEV = original;
    }
  });
});
```

Also add `App` to the existing imports at the top of the file. Change:

```tsx
import { StoreProvider } from "./StoreProvider";
```

to (the file already imports from `./StoreProvider`; add the `App` import on its own line after the `StoreProvider` import):

```tsx
import { StoreProvider } from "./StoreProvider";
import { App } from "./App";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/App.test.tsx`
Expected: FAIL — `<App />` currently renders the demo `StoresScreen` (seed store "Joyería") in the signed-out fallback, so `screen.queryByText("Joyería")` is non-null and `screen.getByText("Sincroniza tus tiendas en la nube")` throws (not found).

- [ ] **Step 3: Commit the failing test**

```bash
git add src/app/App.test.tsx
git commit -m "test: failing test for AuthScreen in production (non-DEV)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Gate the signed-out fallback on DEV

**Files:**
- Modify: `src/app/App.tsx` (imports + the `Root()` signed-out fallback block, lines 28-35)

- [ ] **Step 1: Add the AuthScreen import**

In `src/app/App.tsx`, the imports are (lines 1-7):

```tsx
import { StoreProvider, useStore } from "./StoreProvider";
import { useAuth } from "./firebase/AuthProvider";
import { useRoute } from "./router";
import { AppShell } from "./AppShell";
import { PublicCatalogScreen } from "../features/catalog/PublicCatalogScreen";
import { StoresScreen } from "../features/stores/StoresScreen";
import { StorePickerScreen } from "../features/stores/StorePickerScreen";
```

Add after the `AppShell` import:

```tsx
import { AuthScreen } from "./firebase/AuthScreen";
```

- [ ] **Step 2: Replace the signed-out fallback block**

Replace this block (App.tsx:28-35):

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

with:

```tsx
  // Signed out with no active store. In a built deployment (DEV=false) a visitor
  // must authenticate first — no demo on the public app. In dev/tests (DEV=true)
  // keep the local create-first demo screen.
  if (!activeStore) {
    if (!import.meta.env.DEV) {
      return (
        <div className="min-h-full flex items-center justify-center p-4">
          <div className="w-full max-w-sm">
            <AuthScreen />
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-full">
        <StoresScreen />
      </div>
    );
  }
```

The wrapper `min-h-full flex items-center justify-center p-4` centers `AuthScreen`
(max-width `max-w-sm`) vertically and horizontally and keeps it scrollable on small
screens — `AuthScreen`'s own root is just `space-y-4` with no viewport sizing.

- [ ] **Step 3: Run the test to verify it passes**

Run: `npx vitest run src/app/App.test.tsx`
Expected: PASS — the non-DEV branch now renders `AuthScreen` ("Sincroniza tus tiendas en la nube" present) and the demo store "Joyería" is absent.

- [ ] **Step 4: Run the full unit + design-system suite**

Run: `npm run test`
Expected: PASS (all existing tests green; Vitest runs with `DEV=true`, so nothing else hits the new branch).

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both pass. (`tsc --noEmit` clean; `vite build` produces `dist/`.)

- [ ] **Step 6: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(app): force AuthScreen for signed-out visitors in production

In a built deployment (import.meta.env.DEV === false) a signed-out visitor
with no active store now sees AuthScreen instead of the local demo. Dev and
tests (DEV === true) keep the demo behavior unchanged.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Redeploy and verify end-to-end

**Files:** none (deployment + manual verification)

- [ ] **Step 1: Deploy to production**

Run: `vercel --prod --yes`
Expected: deployment `READY`, aliased to `https://store-os-alpha.vercel.app`.

- [ ] **Step 2: Verify the deployed behavior in a clean browser**

Open `https://store-os-alpha.vercel.app` in a private/clean window (no session, or after signing out).
Expected:
- `AuthScreen` is shown (header "Entrar", subtitle "Sincroniza tus tiendas en la nube", Google button).
- The demo store "Joyería" does NOT appear.
- Centered, mobile-friendly layout (no content hugging the top-left corner).

- [ ] **Step 3: Verify the sign-up → cloud flow**

On the deployed AuthScreen, tap "¿No tienes cuenta? Crear una", register a new email/password (or use Google).
Expected: after success, lands in the store picker / stores screen (cloud data, `user` set), not back at AuthScreen.

- [ ] **Step 4: Verify dev still shows the demo**

Run: `npm run dev`, open `http://localhost:5173`.
Expected: signed-out visitor still sees the demo `StoresScreen` (DEV === true). No regression.

---

## Self-Review (completed)

- **Spec coverage:** Spec requires "non-DEV + no session → AuthScreen" → Task 2. "Keep demo in dev/tests" → the `DEV` gate's true branch (Task 2) + verified empirically in spec. "Minimal test" → Task 1. "Full-screen readiness" → the `min-h-full flex ...` wrapper in Task 2 Step 2 (grounded in the real `AuthScreen` root element, not a guess). "Verification: typecheck/test/build" → Task 2 Steps 4-5. "Redeploy + manual check" → Task 3. All spec sections covered.
- **Placeholder scan:** No TBD/TODO. Every code step shows full code. Test asserts concrete strings ("Sincroniza tus tiendas en la nube", "Joyería") that exist in the codebase.
- **Type consistency:** `AuthScreen` import path `./firebase/AuthScreen` matches its location. `import.meta.env.DEV` usage matches the verified Vitest behavior. No naming drift.
