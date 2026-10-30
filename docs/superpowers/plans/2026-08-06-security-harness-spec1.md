# Security Harness (Espec 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the verified, non-renunciable product guarantees G-P01–G-P08 of the Security Harness spec (Espec 1): Firestore authorization/isolation tests, `adminStores` control plane with `super_admin` separated from data PII, public-projection allow-list gate, no-client-telemetry gate, and the seed of CI authority.

**Architecture:** Two kinds of evidence, matching the repo's existing split. (1) **Static gates** — pure-Node vitest files in `npm run test` (like `design-system-gate.test.ts`) that assert allow-lists and absence of telemetry. (2) **Rules tests** — a new vitest suite using `@firebase/rules-unit-testing` (already installed) that runs against the Firestore emulator via a new `test:rules` script (mirrors how `e2e:firebase` runs against the emulator). Rules + a new `adminStores` canonical control collection enforce isolation and the control/data plane split server-side.

**Tech Stack:** TypeScript, Vitest, `@firebase/rules-unit-testing@^5`, Firestore Security Rules, Playwright (for the G-P08 runtime egress test), GitHub Actions (CI).

**Spec reference:** `docs/superpowers/specs/2026-08-06-security-compliance-harness-design.md`. This plan implements G-P01, G-P02, G-P03, G-P05, G-P06, G-P08 and the harness scaffolding. G-P04 and the `privacyRequests` collection belong to Espec 2 (separate plan). G-P07 (no secrets in client) is already true today; its gate is added here.

> **Revisión posterior:** el diseño original de G-P02 separaba al
> `super_admin` del plano de datos. Esa política fue reemplazada por
> [ADR 0003](../../adr/0003-platform-super-admin-access.md): el superadmin
> puede operar globalmente las tiendas, mientras `adminStores` conserva la
> autoridad de membresía/propiedad y G-P01 mantiene el aislamiento entre
> miembros.

---

## File Structure

**Create:**
- `src/app/firebase/rules-allowlist.ts` — the normative allow-lists (public projection fields, `adminStores` fields, forbidden telemetry packages) as a single source of truth, consumed by both static gates and rules tests.
- `src/security/security-allowlist.gate.test.ts` — static gate (pure Node, in `npm run test`): public-projection allow-list, `adminStores` allow-list, no-telemetry-package.
- `src/app/firebase/firestore.rules.test.ts` — rules tests with `@firebase/rules-unit-testing`, run via `test:rules` against the emulator.
- `e2e/telemetry-egress.spec.ts` — Playwright runtime egress test (G-P08).
- `.github/workflows/ci.yml` — CI: typecheck + test + build + (rules tests against emulator) + e2e.
- `scripts/test-rules.sh` — starts emulator, runs the rules vitest suite, tears down (mirrors `scripts/e2e-firebase.sh`).

**Modify:**
- `firestore.rules` — add `adminStores/{storeId}` match; change `isMember`/`isOwner` to read `adminStores` canonically and drop the `super_admin` short-circuit on data reads; add `stores` read to require `isMember` via `adminStores`.
- `src/main.tsx` — remove `<Analytics/>` and `<SpeedInsights/>` and their imports (G-P08).
- `package.json` — remove `@vercel/analytics`, `@vercel/speed-insights`; add `test:rules` script.
- `src/app/firebase/firestoreData.ts` — `loadCloudState`/`subscribeCloudState` super_admin reads `adminStores` (not `stores` data); write `adminStores` atomically with `stores` on create/update.
- `src/types/index.ts` — add `AdminStore` type.

---

## Task 1: Remove client telemetry (G-P08 — code side)

The spec's G-P08 GAP is the global `<Analytics/>`/`<SpeedInsights/>` in `src/main.tsx`. Remove them and the deps. The static gate (Task 6) and the runtime egress test (Task 9) will then enforce "no reintroduction."

**Files:**
- Modify: `src/main.tsx:1-27`
- Modify: `package.json` (dependencies)

- [ ] **Step 1: Remove imports and components from main.tsx**

Edit `src/main.tsx`. Delete lines 3 and 4 (the two imports) and lines 20 and 21 (the two components). The file becomes:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { ThemeProvider } from "./design-system/theme";
import { AuthProvider } from "./app/firebase/AuthProvider";
import { StoreProvider } from "./app/StoreProvider";
import "./index.css";
import { registerPwa } from "./pwa";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <StoreProvider>
            <App />
          </StoreProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);

registerPwa();
```

- [ ] **Step 2: Remove the two dependencies**

Run:
```bash
npm uninstall @vercel/analytics @vercel/speed-insights
```
Expected: both packages removed from `package.json` `dependencies`; `package-lock.json` updated.

- [ ] **Step 3: Verify typecheck + build pass**

Run:
```bash
npm run typecheck && npm run build
```
Expected: both exit 0. (No remaining references to the removed imports.)

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx package.json package-lock.json
git commit -m "feat(security): remove client telemetry SDKs (G-P08)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Define normative allow-lists as a single source of truth

Centralize the three allow-lists the spec mandates so both static gates and rules tests consume the same constants. This avoids drift between "what the gate checks" and "what the rules/projections actually do."

**Files:**
- Create: `src/app/firebase/rules-allowlist.ts`

- [ ] **Step 1: Write the allow-list module**

Create `src/app/firebase/rules-allowlist.ts`:

```ts
// Normative allow-lists for the Security Harness (Espec 1).
// Single source of truth consumed by static gates (security-allowlist.gate.test.ts)
// and documented intent for Firestore rules + projection builders.
// Changing a list here is a normative decision; reviewers must approve.

// G-P03: exact fields a public projection may carry. Adding a field here is a
// privacy decision — the gate fails if a projection outputs a key not in this list.
export const PUBLIC_STORE_FIELDS = [
  "storeId", "name", "slug", "type", "whatsappPhone", "storefront",
] as const;
export const PUBLIC_PRODUCT_FIELDS = [
  "storeId", "storeSlug", "productSlug", "name", "sku",
  "publicDescription", "images", "material", "finish", "dimensions", "care",
  "availability", "canInquire", "isFeatured", "isNew", "categories",
  "price", "prices",
] as const;

// G-P02: exact fields the control-plane document adminStores/{storeId} may carry.
// All are control metadata, never business content or client PII.
export const ADMIN_STORE_FIELDS = [
  "storeId", "name", "slug", "type", "ownerUid", "memberUids",
  "pendingInvites", "createdAt", "updatedAt", "retainedPrivacyRequestCount",
] as const;
// Absolute exclusions from adminStores (business content / PII).
export const ADMIN_STORE_EXCLUSIONS = [
  "whatsappPhone", "skuPrefix", "storefront",
] as const;

// G-P08: telemetry SDKs the client must never depend on or import.
export const FORBIDDEN_TELEMETRY_PACKAGES = [
  "@vercel/analytics", "@vercel/speed-insights",
] as const;
// G-P08: same-origin routes that must never be hit at runtime.
export const FORBIDDEN_TELEMETRY_ROUTES = [
  "/__vercel/insights", "/_vercel/insights",
] as const;
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/firebase/rules-allowlist.ts
git commit -m "feat(security): normative allow-lists for G-P02/G-P03/G-P08

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Static gate — telemetry + adminStores + projection allow-lists

A pure-Node vitest gate (runs in `npm run test`, no emulator), modeled on `src/design-system/design-system-gate.test.ts`. It enforces the *static* half of G-P03 (projection builders only emit allow-listed keys), G-P08 (no forbidden telemetry package/import), and the `adminStores` allow-list shape.

**Files:**
- Create: `src/security/security-allowlist.gate.test.ts`

- [ ] **Step 1: Write the gate test**

Create `src/security/security-allowlist.gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import {
  FORBIDDEN_TELEMETRY_PACKAGES,
  FORBIDDEN_TELEMETRY_ROUTES,
  ADMIN_STORE_EXCLUSIONS,
} from "../app/firebase/rules-allowlist";

const SRC_FILES = [
  ...globSync("src/**/*.ts"),
  ...globSync("src/**/*.tsx"),
];

describe("security allow-list gate", () => {
  it("no source file imports a forbidden telemetry package", () => {
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      const src = readFileSync(file, "utf8");
      for (const pkg of FORBIDDEN_TELEMETRY_PACKAGES) {
        if (new RegExp(`from\\s+["']${pkg.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`).test(src)) {
          offenders.push(`${file}: imports ${pkg}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no source file references a forbidden telemetry route", () => {
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      const src = readFileSync(file, "utf8");
      for (const route of FORBIDDEN_TELEMETRY_ROUTES) {
        if (src.includes(route)) {
          offenders.push(`${file}: references ${route}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("package.json declares no forbidden telemetry dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const offenders = FORBIDDEN_TELEMETRY_PACKAGES.filter((p) => p in all);
    expect(offenders, `forbidden deps present: ${offenders.join(", ")}`).toEqual([]);
  });

  it("AdminStore type excludes business content / PII fields", () => {
    const typesSrc = readFileSync("src/types/index.ts", "utf8");
    // The AdminStore type must exist and must not declare any excluded field.
    const adminStoreBlock = typesSrc.match(/export type AdminStore = \{[\s\S]*?\};/);
    expect(adminStoreBlock, "AdminStore type not found in src/types/index.ts").not.toBeNull();
    for (const excl of ADMIN_STORE_EXCLUSIONS) {
      expect(adminStoreBlock![0], `AdminStore must not include '${excl}'`).not.toContain(excl);
    }
  });
});
```

- [ ] **Step 2: Add the `AdminStore` type so the gate can pass**

Add to `src/types/index.ts` (after the `Store` type):

```ts
// Control-plane projection of a store (G-P02). Canonical document read by
// super_admin for platform administration. Carries ONLY control metadata;
// never business content (whatsappPhone/skuPrefix/storefront) or client PII.
// See src/app/firebase/rules-allowlist.ts ADMIN_STORE_FIELDS.
export type AdminStore = {
  storeId: string;
  name: string;
  slug: string;
  type: StoreType;
  ownerUid: string;
  memberUids: string[];
  pendingInvites?: string[];
  createdAt: string;
  updatedAt: string;
  retainedPrivacyRequestCount?: number; // counter of ARCO requests still in retention (Espec 2 §9.3)
};
```

- [ ] **Step 3: Run the gate — verify it passes**

Run:
```bash
npm run test -- src/security/security-allowlist.gate.test.ts
```
Expected: 4 tests PASS.

- [ ] **Step 4: Run full test suite to confirm nothing regressed**

Run:
```bash
npm run test
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/security/security-allowlist.gate.test.ts src/types/index.ts
git commit -m "test(security): static allow-list gate (G-P03/G-P08/adminStores)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Projection allow-list unit tests (G-P03 — builder correctness)

The static gate checks imports; this task asserts the projection *builders* (`projectPublicStore`, `projectPublicProductDetail`, `projectPublicProductSummary` in `firestoreData.ts`) only emit allow-listed keys even when the source carries private fields. This is the "inverse test" the spec mandates: adding a private field to the source must NOT change the output.

**Files:**
- Modify: `src/app/firebase/firestoreData.test.ts` (add a new describe block)

- [ ] **Step 1: Read the existing test file to match its style**

Run:
```bash
head -60 src/app/firebase/firestoreData.test.ts
```
Note its imports and how it constructs source objects.

- [ ] **Step 2: Write the failing allow-list assertions**

Append a new `describe` block to `src/app/firebase/firestoreData.test.ts`. Use the allow-list constants. For each projector, build a source object that *includes private fields* and assert the output keys are exactly the allow-list (no private key present).

```ts
import {
  PUBLIC_STORE_FIELDS,
  PUBLIC_PRODUCT_FIELDS,
} from "./rules-allowlist";

describe("public projection allow-list (G-P03)", () => {
  it("projectPublicStore emits only allow-listed keys, excluding business content", () => {
    // Source carries control + business fields; output must be allow-list only.
    const source = {
      id: "s1", name: "Olivia", slug: "olivia", type: "inventory_tiered" as const,
      whatsappPhone: "+52", skuPrefix: "OL", storefront: null,
      ownerUid: "u1", memberUids: ["u1"], pendingInvites: ["x@y.z"],
      createdAt: "t0", updatedAt: "t1",
    };
    const out = projectPublicStore(source as any);
    const outKeys = Object.keys(out);
    // No private/control key leaks:
    for (const forbidden of ["ownerUid", "memberUids", "pendingInvites", "skuPrefix"] as const) {
      expect(outKeys, `projectPublicStore leaked ${forbidden}`).not.toContain(forbidden);
    }
    // Every emitted key is in the allow-list:
    const allow = PUBLIC_STORE_FIELDS as readonly string[];
    for (const k of outKeys) expect(allow, `unexpected key ${k}`).toContain(k);
  });

  it("projectPublicProductDetail emits only allow-listed keys, excluding cost/inventory/notes", () => {
    const source = {
      id: "p1", storeId: "s1", name: "Anillo", sku: "OL-1",
      publicDescription: "d", images: [], material: null, finish: null,
      dimensions: null, care: null, availability: "available", canInquire: true,
      isFeatured: false, isNew: false, status: "published",
      categories: [], price: 100, prices: { retail: 100, wholesale: 80, reseller: 70 },
      // private fields that must NOT appear:
      cost: 50, privateNotes: "n", quantityOnHand: 3, lowStockAt: 1,
      createdAt: "t0", updatedAt: "t1",
    };
    const out = projectPublicProductDetail(source as any, { slug: "olivia" } as any);
    const outKeys = Object.keys(out);
    for (const forbidden of ["cost", "privateNotes", "quantityOnHand", "lowStockAt"] as const) {
      expect(outKeys, `leaked ${forbidden}`).not.toContain(forbidden);
    }
    // prices, if present, must be retail-only:
    if ("prices" in out && out.prices) {
      expect(Object.keys(out.prices as object)).toEqual(["retail"]);
    }
    const allow = PUBLIC_PRODUCT_FIELDS as readonly string[];
    for (const k of outKeys) expect(allow, `unexpected key ${k}`).toContain(k);
  });

  it("adding a private field to the source does not change the public output", () => {
    const base = { id: "s1", name: "Olivia", slug: "olivia", type: "inventory_tiered", whatsappPhone: null, storefront: null } as any;
    const withExtra = { ...base, secretNewField: "leak" };
    expect(projectPublicStore(withExtra)).toEqual(projectPublicStore(base));
  });
});
```

Adjust the exact projector function names/arguments to match what `head -60` revealed (the functions already exist in `firestoreData.ts:257-340` per the spec).

- [ ] **Step 3: Run the tests**

Run:
```bash
npm run test -- src/app/firebase/firestoreData.test.ts
```
Expected: PASS. If a projector leaks a field, fix the projector (not the test) by ensuring it enumerates fields explicitly rather than spreading `...source`.

- [ ] **Step 4: Commit**

```bash
git add src/app/firebase/firestoreData.test.ts src/app/firebase/firestoreData.ts
git commit -m "test(security): projection allow-list unit tests (G-P03)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: `test:rules` script + emulator bootstrap for rules tests

Set up the harness to run Firestore rules tests against the emulator, mirroring the existing `e2e:firebase` pattern. This is the foundation for G-P01/G-P02/G-P05/G-P06 rules tests.

**Files:**
- Create: `scripts/test-rules.sh`
- Modify: `package.json` (add `test:rules` script)

- [ ] **Step 1: Create the runner script**

Create `scripts/test-rules.sh` (mirror `scripts/e2e-firebase.sh`):

```bash
#!/usr/bin/env bash
set -euo pipefail
# Run the Firestore rules test suite against the emulator, then tear down.
firebase emulators:exec --config firebase.emulator.json --only firestore \
  'vitest run --dir-name src/app/firebase --testNamePattern="rules"' 2>/dev/null || \
firebase emulators:exec --config firebase.emulator.json --only firestore \
  'npx vitest run src/app/firebase/firestore.rules.test.ts'
```

Make it executable:
```bash
chmod +x scripts/test-rules.sh
```

Note: `firebase emulators:exec` spawns a fresh emulator, runs the command, tears it down — same as `scripts/e2e-firebase.sh`. The `2>/dev/null` suppresses the verbose emulator banner; remove if debugging.

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `scripts`:
```json
"test:rules": "bash scripts/test-rules.sh",
```

- [ ] **Step 3: Verify the script wiring (no test yet, expect failure is fine)**

Run:
```bash
npm run test:rules
```
Expected: it will fail because `firestore.rules.test.ts` does not exist yet (created in Task 6). Confirm it fails with "no test files found" or a vitest error — NOT with an emulator startup error. If the emulator itself won't start, run `npm run emulators` in another terminal to debug.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-rules.sh package.json
git commit -m "test(security): add test:rules runner against Firestore emulator

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Rules tests scaffold + G-P05/G-P06 (anonymous + storeId invariance)

Write the first rules tests. These assert the *current* rules behavior that already passes (anonymous denied on private collections; `update` that changes `storeId` denied). They lock in the baseline before Task 7 changes the rules for `adminStores`.

**Files:**
- Create: `src/app/firebase/firestore.rules.test.ts`

- [ ] **Step 1: Write the rules test scaffold + baseline assertions**

Create `src/app/firebase/firestore.rules.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";

let env: RulesTestEnvironment;

const PROJ = "store-os-dev";

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJ,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});

async function asUser(uid: string) {
  const ctx = env.authenticatedContext(uid);
  return ctx.firestore();
}

describe("G-P05 anonymous cannot write private collections", () => {
  it("anonymous cannot create a customer", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, "customers/c1"), { storeId: "s1", name: "x" }));
  });
  it("anonymous cannot read a public projection (allowed) but cannot write it", async () => {
    const db = env.unauthenticatedContext().firestore();
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "publicStores/olivia"), { storeId: "s1" });
    });
    await assertSucceeds(getDoc(doc(db, "publicStores/olivia")));
    await assertFails(setDoc(doc(db, "publicStores/olivia"), { storeId: "s1" }));
  });
});

describe("G-P06 storeId invariance on update", () => {
  it("member cannot change storeId of a product to another store", async () => {
    // Seed: store s1 with member u1, a product in s1.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "stores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "products/p1"), { storeId: "s1", name: "x" });
    });
    const db = await asUser("u1");
    // Same-store update allowed:
    await assertSucceeds(updateDoc(doc(db, "products/p1"), { name: "y" }));
    // Cross-store update denied:
    await assertFails(updateDoc(doc(db, "products/p1"), { storeId: "s2" }));
  });
});
```

- [ ] **Step 2: Run the rules tests**

Run:
```bash
npm run test:rules
```
Expected: PASS (these assert current behavior). If G-P06 "cross-store update denied" fails, the current rules may not enforce `resource.data.storeId == request.resource.data.storeId` on the changing field — check `firestore.rules:74-77`; the rule is already there, so it should pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/firebase/firestore.rules.test.ts
git commit -m "test(security): rules baseline — G-P05 anonymous, G-P06 storeId (G-P01/G-P02 scaffold)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Add `adminStores` collection + isolate `super_admin` from data PII (G-P02 — rules)

The core G-P02 change. Add `adminStores/{storeId}` as the canonical control document. Change `isMember`/`isOwner` to read membership from `adminStores` (not `stores`). Remove the `isSuperAdmin()` short-circuit from data reads so `super_admin` cannot read `customers`/`orders`/etc. of a store they don't belong to. `stores` stays as the business document (read by members).

**Files:**
- Modify: `firestore.rules:13-23` (membership functions), add `adminStores` match
- Modify: `src/app/firebase/firestore.rules.test.ts` (add G-P01/G-P02 tests)

- [ ] **Step 1: Write the failing G-P01/G-P02 rules tests**

Append to `firestore.rules.test.ts`:

```ts
describe("G-P01 isolation between stores", () => {
  it("member of s1 cannot read s2's customer by known id", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "adminStores/s2"), { ownerUid: "u2", memberUids: ["u2"] });
      await setDoc(doc(c.firestore(), "customers/c2"), { storeId: "s2", name: "secret" });
    });
    const db = await asUser("u1");
    await assertFails(getDoc(doc(db, "customers/c2")));
  });
});

describe("G-P02 super_admin cannot read data PII by role", () => {
  it("super_admin (not a member) cannot read customers/orders of s1", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s1"), { ownerUid: "u1", memberUids: ["u1"] });
      await setDoc(doc(c.firestore(), "users/admin"), { email: "admin@store.os", role: "super_admin" });
      await setDoc(doc(c.firestore(), "customers/c1"), { storeId: "s1", name: "x", phone: "555" });
      await setDoc(doc(c.firestore(), "orders/o1"), { storeId: "s1", productName: "x" });
    });
    const db = await asUser("admin"); // role super_admin
    await assertFails(getDoc(doc(db, "customers/c1")));
    await assertFails(getDoc(doc(db, "orders/o1")));
  });
  it("super_admin can read adminStores (control plane)", async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "adminStores/s1"), { storeId: "s1", name: "Olivia", ownerUid: "u1", memberUids: ["u1"] });
    });
    const db = await asUser("admin");
    await assertSucceeds(getDoc(doc(db, "adminStores/s1")));
  });
});
```

- [ ] **Step 2: Run — verify the new tests FAIL (rules not yet changed)**

Run:
```bash
npm run test:rules
```
Expected: the G-P02 "cannot read customers" test FAILS today (because `isSuperAdmin()` short-circuits `isMember`). The "can read adminStores" test FAILS too (no match yet). This confirms the tests are real.

- [ ] **Step 3: Add `adminStores` and rewrite the membership functions in firestore.rules**

Edit `firestore.rules`. Replace the `isMember`/`isOwner` functions (lines 13-23) and add an `adminStores` match. New membership functions read the canonical `adminStores` doc:

```
    // Canonical control-plane document. adminStores/{storeId} is the ONLY source
    // of authority for membership/ownership. `stores/{id}` copies are derived.
    function adminStore(storeId) {
      return get(/databases/$(database)/documents/adminStores/$(storeId)).data;
    }
    function isMember(storeId) {
      return isSignedIn()
        && exists(/databases/$(database)/documents/adminStores/$(storeId))
        && adminStore(storeId).memberUids.hasAny([request.auth.uid]);
    }
    function isOwner(storeId) {
      return isSignedIn()
        && exists(/databases/$(database)/documents/adminStores/$(storeId))
        && adminStore(storeId).ownerUid == request.auth.uid;
    }
```

Note: `isSuperAdmin()` NO LONGER appears in `isMember`/`isOwner`. This is the deliberate removal of the data-plane short-circuit (G-P02).

Add the `adminStores` match block (after the `users` match):

```
    // adminStores/{storeId} — canonical control plane. super_admin reads all
    // (platform administration); only the owner (or the system in a batched
    // write with stores) may write. Carries ONLY control metadata (G-P02).
    match /adminStores/{storeId} {
      allow get: if isSuperAdmin() || isOwner(storeId) || isMember(storeId);
      allow list: if isSuperAdmin();
      allow create, update: if isOwner(storeId)
        && request.resource.data.ownerUid == resource.data.ownerUid;
      allow delete: if isSuperAdmin() == false && isOwner(storeId);
    }
```

(Leave `stores/{id}` `get`/`create`/`update`/`delete` rules as-is — members still read business content of their store via `isMember`, which now consults `adminStores`. **But tighten the `stores` `list` rule** (currently `allow list: if isSuperAdmin() || ...`) to **remove the `isSuperAdmin()` branch** so super_admin cannot enumerate store business docs:

```
    match /stores/{id} {
      allow get: if isMember(id);
      allow list: if isSignedIn()
        && resource.data.memberUids.hasAny([request.auth.uid]);
      // ... create/update/delete unchanged
    }
```

This closes the G-P02 hole: super_admin lists control via `adminStores` (the `list: if isSuperAdmin()` there stays), never business content via `stores`. If the super_admin platform dashboard relied on listing `stores`, it must switch to listing `adminStores` — that is the intended behavior change of Task 8.)

- [ ] **Step 4: Run the rules tests — verify G-P01/G-P02 now PASS**

Run:
```bash
npm run test:rules
```
Expected: all rules tests PASS, including the two new G-P02 tests. If `super_admin can read adminStores` fails, confirm `isSuperAdmin()` still resolves (it reads `users/{uid}.role` — the seed in step 1 set `users/admin` role `super_admin`).

- [ ] **Step 5: Run the full unit suite to catch non-rules regressions**

Run:
```bash
npm run test
```
Expected: PASS (rules changes don't affect vitest unit tests).

- [ ] **Step 6: Commit**

```bash
git add firestore.rules src/app/firebase/firestore.rules.test.ts
git commit -m "feat(security): adminStores control plane, super_admin isolated from data PII (G-P02)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Write `adminStores` atomically with `stores` in the client adapter (G-P02 — client)

The rules now require `adminStores` to exist for membership. The client adapter (`firestoreData.ts`) must write `adminStores` in the same batched write as `stores` on create/update, and `loadCloudState` for `super_admin` must read `adminStores` (control) instead of the `stores` god-view (data).

**Files:**
- Modify: `src/app/firebase/firestoreData.ts` (store create/update path + `loadCloudState` super_admin branch)

- [ ] **Step 1: Locate the store create/update write path**

Run:
```bash
grep -n "saveEntity\|collection(db, \"stores\")\|writeBatch\|setDoc" src/app/firebase/firestoreData.ts | head -20
```
Identify the function that writes a store doc (likely calls `saveEntity(user, "stores", ...)`).

- [ ] **Step 2: Write `adminStores` in a batched write alongside `stores`**

In the store save path, replace the single `setDoc(stores/{id})` with a `writeBatch` that writes both `stores/{id}` (business) and `adminStores/{id}` (control projection, allow-list fields only). Sketch:

```ts
import { writeBatch, doc, collection } from "firebase/firestore";

// Inside the store-save function, after computing the store object:
const batch = writeBatch(db);
batch.set(doc(db, "stores", store.id), store);                 // business content
batch.set(doc(db, "adminStores", store.id), {                  // control-plane projection
  storeId: store.id,
  name: store.name, slug: store.slug, type: store.type,
  ownerUid: store.ownerUid ?? user.uid,
  memberUids: store.memberUids ?? [user.uid],
  pendingInvites: store.pendingInvites ?? [],
  createdAt: store.createdAt, updatedAt: store.updatedAt,
  retainedPrivacyRequestCount: 0,
});
await batch.commit();
```

Adjust the exact code to the function's existing shape (variable names, whether it uses `saveEntity`). The key invariant: **both docs written in one batch**, so there's no window where `adminStores` doesn't exist for a `stores` doc.

- [ ] **Step 3: Change `loadCloudState` super_admin branch to read `adminStores`**

In `loadCloudState`, the `if (user.role === "super_admin")` branch currently reads `collection(db, "stores")` (the god-view). Change it to read `collection(db, "adminStores")` and map to `AdminStore`. The member branch stays reading `stores` via the `memberUids` query (those keys are in `adminStores` too, so the query still works against `adminStores` if preferred — but minimally, super_admin must not pull business content).

```ts
if (user.role === "super_admin") {
  const snap = await getDocs(collection(db, "adminStores"));
  stores = snap.docs.map((d) => ({ ...(d.data() as Store), id: d.id }));
  // Note: AdminStore lacks whatsappPhone/skuPrefix/storefront; the admin UI that
  // super_admin uses for platform administration only needs control fields.
}
```

- [ ] **Step 4: Run typecheck + unit tests**

Run:
```bash
npm run typecheck && npm run test
```
Expected: PASS. If a unit test asserts the super_admin god-view returned full store content, update the test to expect the control-plane shape (this is the intended behavior change).

- [ ] **Step 5: Commit**

```bash
git add src/app/firebase/firestoreData.ts
git commit -m "feat(security): write adminStores atomically; super_admin reads control plane (G-P02)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: G-P08 runtime egress test (Playwright)

The static gate (Task 3) catches packages/imports. This Playwright test catches runtime egress to forbidden routes/hosts — the `sendBeacon`/`fetch` case the static gate can't see.

**Files:**
- Create: `e2e/telemetry-egress.spec.ts`

- [ ] **Step 1: Write the runtime egress test**

Create `e2e/telemetry-egress.spec.ts`:

```ts
import { test, expect, type Request } from "@playwright/test";
import { FORBIDDEN_TELEMETRY_ROUTES } from "../src/app/firebase/rules-allowlist";

// G-P08: no runtime egress to telemetry routes/hosts. Catches sendBeacon/fetch
// the static gate cannot see.
test("catalog route makes no request to forbidden telemetry routes", async ({ page }) => {
  const violations: string[] = [];
  page.on("request", (req: Request) => {
    const url = req.url();
    for (const route of FORBIDDEN_TELEMETRY_ROUTES) {
      if (url.includes(route)) violations.push(url);
    }
    // Deny hosts outside the allow-list (same-origin app resources + firebase + wa.me).
    const u = new URL(url);
    const host = u.hostname;
    const isSameOrigin = u.origin === new URL(page.url()).origin && !FORBIDDEN_TELEMETRY_ROUTES.some((r) => u.pathname.startsWith(r));
    const allowed = isSameOrigin || host.endsWith("firebaseapp.com")
      || host.endsWith("googleapis.com") || host === "wa.me" || host.endsWith("firebasedatabase.app");
    if (!allowed) violations.push(`${url} (host ${host})`);
  });
  await page.goto("/catalogo/olivia");
  await page.waitForLoadState("networkidle");
  expect(violations, `forbidden egress: ${violations.join(", ")}`).toEqual([]);
});
```

- [ ] **Step 2: Run the e2e suite**

Run:
```bash
npm run e2e
```
Expected: PASS. Since Task 1 removed the telemetry SDKs, no `/_vercel/insights` request should fire. If it fails, a residual telemetry call remains — find and remove it.

- [ ] **Step 3: Commit**

```bash
git add e2e/telemetry-egress.spec.ts
git commit -m "test(security): runtime telemetry egress gate (G-P08)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: CI workflow — the authoritative gate

Wire everything into GitHub Actions so CI is the authority (G-H03). The workflow runs typecheck + test + build (static gates included) on every PR/merge to `main`, and the rules tests + e2e against the emulator.

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - name: Lint (typecheck)
        run: npm run typecheck
      - name: Unit + static gates
        run: npm run test
      - name: Build
        run: npm run build
        env:
          # check-env.cjs requires the public Firebase config present.
          VITE_FIREBASE_API_KEY: ${{ secrets.VITE_FIREBASE_API_KEY }}
          VITE_FIREBASE_AUTH_DOMAIN: ${{ secrets.VITE_FIREBASE_AUTH_DOMAIN }}
          VITE_FIREBASE_PROJECT_ID: ${{ secrets.VITE_FIREBASE_PROJECT_ID }}
          VITE_FIREBASE_STORAGE_BUCKET: ${{ secrets.VITE_FIREBASE_STORAGE_BUCKET }}
          VITE_FIREBASE_SENDER_ID: ${{ secrets.VITE_FIREBASE_SENDER_ID }}
          VITE_FIREBASE_APP_ID: ${{ secrets.VITE_FIREBASE_APP_ID }}

  rules-and-e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - name: Install Firebase CLI
        run: npm i -g firebase-tools
      - name: Firestore rules tests (emulator)
        run: npm run test:rules
      - name: E2E (Playwright)
        run: npm run e2e
```

- [ ] **Step 2: Verify the workflow file is valid YAML**

Run:
```bash
node -e "require('fs').readFileSync('.github/workflows/ci.yml','utf8'); console.log('ok')"
```
(No YAML parser in CI build here; GitHub will validate on push. The `node` check just confirms the file exists and is readable.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(security): GitHub Actions — typecheck/test/build + rules(emulator) + e2e

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Document the harness in CLAUDE.md

Record the new scripts and the G-P0x guarantees so future agents know the gates exist and how to run them.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the new commands and a security note to CLAUDE.md**

In the "## Comandos" section, add:
```bash
npm run test:rules   # pruebas de firestore.rules contra el emulador (G-P01/G-P02/G-P05/G-P06)
```

In "## Convenciones", add a bullet:
```
- **Garantías de seguridad G-P01–G-P08 (Espec 1):** aislamiento entre tiendas, super_admin sin PII por rol (adminStores), proyecciones públicas con allow-list, sin telemetría en el cliente. Ver `docs/superpowers/specs/2026-08-06-security-compliance-harness-design.md`. Las compuertas estáticas corren en `npm run test`; las de reglas en `npm run test:rules`; egress runtime en `npm run e2e`. Ninguna es renunciable.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(security): document G-P01–G-P08 gates and test:rules

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Verification (end-to-end)

After all tasks, confirm the harness works as the spec mandates:

- [ ] **Static gates green:** `npm run test` passes, including `security-allowlist.gate.test.ts` (4 tests) and the projection allow-list tests.
- [ ] **Rules gates green:** `npm run test:rules` passes G-P01 (isolation), G-P02 (super_admin denied data PII, reads adminStores), G-P05 (anonymous denied), G-P06 (storeId invariance).
- [ ] **Build green:** `npm run build` passes (telemetry removed cleanly).
- [ ] **E2E green:** `npm run e2e` passes, including `telemetry-egress.spec.ts` (no forbidden runtime egress).
- [ ] **G-P08 manual check:** `grep -r "@vercel/analytics\|@vercel/speed-insights" src/ package.json` returns nothing.
- [ ] **G-P02 manual check:** with a super_admin session in the dev app, confirm the admin view shows control metadata only — not customer phones/notes of a store super_admin isn't a member of. (Open `/catalogo` flow, switch to admin, inspect network/state.)

## Notes / out of scope for this plan

- **G-P04 (`privacyRequests`) and the ARCO collection** belong to Espec 2 — separate plan. The `retainedPrivacyRequestCount` field is added to `adminStores` now (it's harmless at 0) so the schema is ready.
- **G-P07 (no secrets in client)** is already true; no code change. The static gate in Task 3 does not re-check it, but a future task could add a repo-scan for `service-account*.json`.
- **`stores/{id}` `list` rule** is tightened in Task 7 (remove `isSuperAdmin()` branch) to fully close G-P02 — super_admin lists control via `adminStores`, never business content.
