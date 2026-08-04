# Inventory Purchase Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Fer record supplier purchases (multi-line tickets) that replenish stock and update weighted-average cost, with stock reserved on order creation and an inventory view distinguishing available / committed / physical.

**Architecture:** Two new per-store entities (`Supplier`, `Purchase`) follow the existing Category wiring pattern (reducer actions, context methods, cloud adapter, firestore rule). Pure costing/reservation math lives in `src/lib/inventory.ts` (unit-tested). The purchase form is the first repeating line-item form in the app. Stock reservation hooks into `OrderForm.submit` and `OrderCard` lifecycle.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind + Firebase Firestore; vitest for tests; the design-system primitives (TextField, SelectField, Sheet, StatRow, etc.).

**Spec:** `docs/superpowers/specs/2026-08-04-inventory-purchase-transactions-design.md`

---

## File Structure

**Create:**
- `src/lib/inventory.ts` — pure functions: weighted-average cost, committed-stock sum, apply-purchase-to-products, reserve-on-order, restore-on-delete.
- `src/lib/inventory.test.ts` — unit tests for all the above.
- `src/features/inventory/PurchaseForm.tsx` — multi-line purchase entry (supplier, date, lines, totals).
- `src/features/inventory/SuppliersScreen.tsx` — light CRUD for suppliers.
- `src/features/inventory/PurchaseList.tsx` — purchase history view.

**Modify:**
- `src/types/index.ts` — add `Supplier`, `Purchase`, `PurchaseLine` types; extend `AppState`.
- `src/lib/selectors.ts` — add `suppliersForStore`, `purchasesForStore`, `committedForProduct`.
- `src/app/StoreProvider.tsx` — reducer actions + context methods for suppliers/purchases; stock reservation on order upsert/delete; `newSupplier`/`newPurchase` factories.
- `src/app/firebase/firestoreData.ts` — add `suppliers`/`purchases` to COLLECTIONS, forStores, loader, listeners.
- `src/features/orders/OrderForm.tsx` — reserve stock on submit (decrement product quantityOnHand).
- `src/features/orders/OrderCard.tsx` — no structural change (badge already exists); confirm restore-on-delete wiring.
- `src/features/inventory/InventoryScreen.tsx` — redesign: Disponible/Comprometido/Físico + "+ Compra" button + purchase list access.
- `firestore.rules` — add `suppliers/{id}` and `purchases/{id}` membership-gated blocks.

---

## Task 1: Pure inventory math — weighted average cost

**Files:**
- Create: `src/lib/inventory.ts`
- Test: `src/lib/inventory.test.ts`

- [ ] **Step 1: Write the failing tests for weighted-average cost**

Create `src/lib/inventory.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { weightedAverageCost, applyPurchaseLines } from "./inventory";
import type { Product, PurchaseLine } from "../types";

describe("weightedAverageCost", () => {
  it("returns the new unit cost when there is no existing stock", () => {
    expect(weightedAverageCost(undefined, 0, 5, 10)).toBe(10);
    expect(weightedAverageCost(undefined, undefined, 3, 20)).toBe(20);
  });
  it("computes weighted average with existing stock at a known cost", () => {
    // 5 units @ $10 + 5 units @ $15 = 10 units @ $12.5
    expect(weightedAverageCost(10, 5, 5, 15)).toBe(12.5);
  });
  it("treats existing stock contribution as 0 when qty is 0 or negative", () => {
    expect(weightedAverageCost(10, 0, 5, 15)).toBe(15);
    expect(weightedAverageCost(10, -2, 5, 15)).toBe(15);
  });
  it("returns new unit cost when existing cost is undefined", () => {
    expect(weightedAverageCost(undefined, 5, 5, 15)).toBe(15);
  });
});

describe("applyPurchaseLines", () => {
  const baseProduct = (o: Partial<Product> = {}): Product => ({
    id: "p1", storeId: "s1", name: "Anillo", category: "jewelry", isPublic: true,
    ...o,
  } as Product);

  it("updates quantityOnHand and cost for each matching product", () => {
    const products = [baseProduct({ id: "a", quantityOnHand: 5, cost: 10 })];
    const lines: PurchaseLine[] = [
      { productId: "a", name: "Anillo", quantity: 5, unitCost: 15 },
    ];
    const result = applyPurchaseLines(products, lines);
    expect(result.get("a")).toEqual({ quantityOnHand: 10, cost: 12.5 });
  });
  it("handles multiple lines for different products", () => {
    const products = [
      baseProduct({ id: "a", quantityOnHand: 2, cost: 10 }),
      baseProduct({ id: "b", quantityOnHand: 0, cost: undefined }),
    ];
    const lines: PurchaseLine[] = [
      { productId: "a", name: "A", quantity: 3, unitCost: 20 },
      { productId: "b", name: "B", quantity: 4, unitCost: 7 },
    ];
    const result = applyPurchaseLines(products, lines);
    expect(result.get("a")).toEqual({ quantityOnHand: 5, cost: 16 });
    expect(result.get("b")).toEqual({ quantityOnHand: 4, cost: 7 });
  });
  it("ignores lines whose product is not in the array", () => {
    const products = [baseProduct({ id: "a", quantityOnHand: 1, cost: 5 })];
    const lines: PurchaseLine[] = [
      { productId: "missing", name: "X", quantity: 10, unitCost: 3 },
    ];
    const result = applyPurchaseLines(products, lines);
    expect(result.has("missing")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/inventory.test.ts`
Expected: FAIL — "Cannot find module './inventory'"

- [ ] **Step 3: Write the implementation**

Create `src/lib/inventory.ts`:

```typescript
import type { Product, PurchaseLine } from "../types";

/**
 * Weighted-average cost after a purchase.
 * ((currentQty × currentCost) + (buyQty × buyCost)) / (currentQty + buyQty)
 * When currentQty is undefined/0/negative, or currentCost undefined, the
 * existing stock contributes 0 — the new unit cost wins.
 */
export function weightedAverageCost(
  currentCost: number | undefined,
  currentQty: number | undefined,
  buyQty: number,
  buyCost: number
): number {
  const existingQty = typeof currentQty === "number" && currentQty > 0 ? currentQty : 0;
  const existingCost = typeof currentCost === "number" && existingQty > 0 ? currentCost : 0;
  const totalQty = existingQty + buyQty;
  if (totalQty <= 0) return buyCost;
  return (existingQty * existingCost + buyQty * buyCost) / totalQty;
}

export type ProductStockUpdate = { quantityOnHand: number; cost: number };

/**
 * Compute the stock + cost updates a purchase applies to each product.
 * Returns a Map<productId, ProductStockUpdate>. Lines whose product isn't in
 * the array are ignored (the product was deleted). Pure — caller writes.
 */
export function applyPurchaseLines(
  products: Product[],
  lines: PurchaseLine[]
): Map<string, ProductStockUpdate> {
  const byId = new Map(products.map((p) => [p.id, p]));
  const updates = new Map<string, ProductStockUpdate>();
  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product) continue;
    const currentQty = typeof product.quantityOnHand === "number" ? product.quantityOnHand : 0;
    const newQty = currentQty + line.quantity;
    const newCost = weightedAverageCost(product.cost, currentQty, line.quantity, line.unitCost);
    updates.set(line.productId, { quantityOnHand: newQty, cost: newCost });
  }
  return updates;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/inventory.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory.ts src/lib/inventory.test.ts
git commit -m "feat(inventory): weighted-average cost + purchase-line application"
```

---

## Task 2: Committed-stock + reservation math

**Files:**
- Modify: `src/lib/inventory.ts`
- Modify: `src/lib/inventory.test.ts`

- [ ] **Step 1: Add failing tests for committed stock and reservation delta**

Append to `src/lib/inventory.test.ts`:

```typescript
import { committedForProduct, reservationDelta } from "./inventory";
import type { Order } from "../types";

describe("committedForProduct", () => {
  const order = (o: Partial<Order> = {}): Order => ({
    id: "o1", storeId: "s1", customerId: "c1", productName: "X",
    quantity: 1, price: 10, deposit: 0, status: "asked",
    createdAt: "", updatedAt: "",
    ...o,
  } as Order);

  it("sums quantities of open orders for a product", () => {
    const orders = [
      order({ id: "a", productId: "p1", quantity: 3, status: "confirmed" }),
      order({ id: "b", productId: "p1", quantity: 2, status: "asked" }),
      order({ id: "c", productId: "p1", quantity: 5, status: "delivered" }),
      order({ id: "d", productId: "p2", quantity: 9, status: "asked" }),
    ];
    expect(committedForProduct(orders, "s1", "p1")).toBe(5); // 3+2, not delivered
  });
  it("returns 0 when no open orders reference the product", () => {
    expect(committedForProduct([], "s1", "p1")).toBe(0);
  });
  it("ignores cancelled-style terminal statuses", () => {
    const orders = [order({ productId: "p1", quantity: 4, status: "paid" })];
    expect(committedForProduct(orders, "s1", "p1")).toBe(0);
  });
});

describe("reservationDelta", () => {
  it("returns the stock change needed when an order quantity changes", () => {
    // new order of 3 (no old) -> reserve 3
    expect(reservationDelta(undefined, 3)).toBe(-3);
    // edit from 3 to 5 -> reserve 2 more
    expect(reservationDelta(3, 5)).toBe(-2);
    // edit from 5 to 2 -> release 3
    expect(reservationDelta(5, 2)).toBe(3);
    // delete (newQty undefined) -> release all
    expect(reservationDelta(5, undefined)).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/inventory.test.ts`
Expected: FAIL — "committedForProduct is not defined"

- [ ] **Step 3: Implement committed-stock and reservation-delta**

Append to `src/lib/inventory.ts`:

```typescript
import type { Order, OrderStatus } from "../types";

// Order statuses that are "still open" — the stock is still committed.
// Once delivered/paid, the stock is no longer committed (it's gone).
const OPEN_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "asked", "confirmed", "to_buy", "bought", "arrived",
]);

/**
 * Sum of quantities of open (non-terminal) orders for a product in a store.
 * Used to show "Comprometido" alongside the available quantityOnHand.
 */
export function committedForProduct(
  orders: Order[],
  storeId: string,
  productId: string
): number {
  return orders
    .filter(
      (o) =>
        o.storeId === storeId &&
        o.productId === productId &&
        OPEN_STATUSES.has(o.status)
    )
    .reduce((sum, o) => sum + o.quantity, 0);
}

/**
 * The stock delta to apply when an order's reserved quantity changes.
 * Returns negative for reserve (more stock held), positive for release.
 * oldQty undefined = new order; newQty undefined = deletion.
 */
export function reservationDelta(
  oldQty: number | undefined,
  newQty: number | undefined
): number {
  const oldResolved = oldQty ?? 0;
  const newResolved = newQty ?? 0;
  return oldResolved - newResolved; // negative = reserve, positive = release
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/inventory.test.ts`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory.ts src/lib/inventory.test.ts
git commit -m "feat(inventory): committed-stock sum + reservation delta"
```

---

## Task 3: Types — Supplier, Purchase, PurchaseLine, AppState

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add the new types**

In `src/types/index.ts`, after the `Category` type block, add:

```typescript
/** A supplier Fer buys stock from. Per-store, like Category. */
export type Supplier = {
  id: string;
  storeId: string;
  name: string;
  contact?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

/** One line of a purchase ticket: a product bought, how many, at what unit cost. */
export type PurchaseLine = {
  productId: string;
  name: string; // snapshot
  quantity: number;
  unitCost: number;
};

/** A supplier purchase (a "ticket"): multiple lines, a total Fer confirms. */
export type Purchase = {
  id: string;
  storeId: string;
  supplierId?: string;
  date: string;
  notes?: string;
  lines: PurchaseLine[];
  subtotal: number; // Σ quantity × unitCost (computed)
  totalConfirmed: number;
  createdAt: string;
  updatedAt: string;
};
```

Extend `AppState` (add `suppliers` and `purchases`):

```typescript
export type AppState = {
  stores: Store[];
  activeStoreId: string | null;
  products: Product[];
  categories: Category[];
  suppliers: Supplier[];
  purchases: Purchase[];
  customers: Customer[];
  orders: Order[];
};
```

- [ ] **Step 2: Fix the compile errors from the new AppState fields**

Every place that constructs an `AppState` literal must now include `suppliers` and `purchases`. Run typecheck to find them:

Run: `npm run typecheck`
Expected: errors in `src/lib/storage.ts` (emptyState/normalizeState), `src/lib/seed.ts`, and `src/app/firebase/firestoreData.ts` (loadCloudState return).

Fix each by adding `suppliers: []` and `purchases: []` (or the seeded data). In `src/lib/storage.ts`:
- `emptyState()`: add `suppliers: [], purchases: []`
- `normalizeState()`: add `suppliers: s?.suppliers ?? [], purchases: s?.purchases ?? []`

In `src/lib/seed.ts` return object: add `suppliers: [], purchases: []`.

In `src/app/firebase/firestoreData.ts` `loadCloudState` return: add the two collections to the loader (see Task 5) — for now add `suppliers: [], purchases: []` to make it compile.

- [ ] **Step 3: Run typecheck to verify clean**

Run: `npm run typecheck`
Expected: PASS (no errors)

- [ ] **Step 4: Run existing tests to confirm nothing broke**

Run: `npm test`
Expected: PASS (all existing tests — AppState shape change is additive)

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/lib/storage.ts src/lib/seed.ts src/app/firebase/firestoreData.ts
git commit -m "feat(types): add Supplier, Purchase, PurchaseLine; extend AppState"
```

---

## Task 4: Selectors — suppliersForStore, purchasesForStore, committedForProduct

**Files:**
- Modify: `src/lib/selectors.ts`

- [ ] **Step 1: Add the selectors**

In `src/lib/selectors.ts`, add imports and functions:

```typescript
import type { Product, Order, Customer, Category, Supplier, Purchase } from "../types";
import { committedForProduct as committedForProductImpl } from "./inventory";

export function suppliersForStore(suppliers: Supplier[], storeId: string): Supplier[] {
  return suppliers.filter((s) => s.storeId === storeId);
}

export function purchasesForStore(purchases: Purchase[], storeId: string): Purchase[] {
  return purchases.filter((p) => p.storeId === storeId);
}

/** Re-export the committed-stock helper from inventory.ts for UI convenience. */
export function committedForProduct(orders: Order[], storeId: string, productId: string): number {
  return committedForProductImpl(orders, storeId, productId);
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/selectors.ts
git commit -m "feat(selectors): suppliersForStore, purchasesForStore, committedForProduct"
```

---

## Task 5: StoreProvider — reducer actions + context methods + factories

**Files:**
- Modify: `src/app/StoreProvider.tsx`

This is the wiring task. Follow the exact Category pattern.

- [ ] **Step 1: Add imports and action types**

At the top of `StoreProvider.tsx`, add `Supplier, Purchase` to the type import. Add these to the `Action` union:

```typescript
  | { type: "ADD_SUPPLIER"; supplier: Supplier }
  | { type: "UPDATE_SUPPLIER"; supplier: Supplier }
  | { type: "DELETE_SUPPLIER"; supplierId: string }
  | { type: "ADD_PURCHASE"; purchase: Purchase }
  | { type: "UPDATE_PURCHASE"; purchase: Purchase }
  | { type: "DELETE_PURCHASE"; purchaseId: string }
```

- [ ] **Step 2: Add reducer cases + cascade on DELETE_STORE**

In `reducer()`, add the supplier/purchase cases mirroring categories:

```typescript
    case "ADD_SUPPLIER":
      return { ...state, suppliers: [...state.suppliers, action.supplier] };
    case "UPDATE_SUPPLIER":
      return { ...state, suppliers: state.suppliers.map((s) => (s.id === action.supplier.id ? action.supplier : s)) };
    case "DELETE_SUPPLIER":
      return { ...state, suppliers: state.suppliers.filter((s) => s.id !== action.supplierId) };
    case "ADD_PURCHASE":
      return { ...state, purchases: [...state.purchases, action.purchase] };
    case "UPDATE_PURCHASE":
      return { ...state, purchases: state.purchases.map((p) => (p.id === action.purchase.id ? action.purchase : p)) };
    case "DELETE_PURCHASE":
      return { ...state, purchases: state.purchases.filter((p) => p.id !== action.purchaseId) };
```

In the `DELETE_STORE` case, add cascade cleanup (like products/customers/orders):

```typescript
        suppliers: state.suppliers.filter((s) => s.storeId !== action.storeId),
        purchases: state.purchases.filter((p) => p.storeId !== action.storeId),
```

- [ ] **Step 3: Add context methods + persistEntity wiring**

Add to `StoreContextValue`:

```typescript
  upsertSupplier: (supplier: Supplier) => void;
  deleteSupplier: (supplierId: string) => void;
  upsertPurchase: (purchase: Purchase) => void;
  deletePurchase: (purchaseId: string) => void;
```

Implement them in the `value` object (mirror `upsertCategory`):

```typescript
    upsertSupplier: (supplier) => {
      dispatch({ type: state.suppliers.some((s) => s.id === supplier.id) ? "UPDATE_SUPPLIER" : "ADD_SUPPLIER", supplier });
      persistEntity("suppliers", supplier);
    },
    deleteSupplier: (supplierId) => {
      dispatch({ type: "DELETE_SUPPLIER", supplierId });
      if (cloud && user && !fromCloud.current) deleteEntity(user, "suppliers", supplierId).catch(() => {});
    },
    upsertPurchase: (purchase) => {
      dispatch({ type: state.purchases.some((p) => p.id === purchase.id) ? "UPDATE_PURCHASE" : "ADD_PURCHASE", purchase });
      persistEntity("purchases", purchase);
    },
    deletePurchase: (purchaseId) => {
      dispatch({ type: "DELETE_PURCHASE", purchaseId });
      if (cloud && user && !fromCloud.current) deleteEntity(user, "purchases", purchaseId).catch(() => {});
    },
```

Update the `persistEntity` name union to include `"suppliers" | "purchases"`.

- [ ] **Step 4: Add factory functions**

At the bottom (next to `newCategory`):

```typescript
export function newSupplier(storeId: string): Supplier {
  const now = nowIso();
  return { id: uid("supplier"), storeId, name: "", createdAt: now, updatedAt: now };
}
export function newPurchase(storeId: string): Purchase {
  const now = nowIso();
  return { id: uid("purchase"), storeId, date: now.slice(0, 10), lines: [], subtotal: 0, totalConfirmed: 0, createdAt: now, updatedAt: now };
}
```

- [ ] **Step 5: Add stock reservation to upsertOrder and deleteOrder**

In `upsertOrder`, after dispatching, if `cloud`/non-cloud and the product has stock, apply the reservation delta. Add at the start of the method (before dispatch):

```typescript
    upsertOrder: (order) => {
      // Reserve/release stock: compare the existing order's quantity to the new one.
      const prev = state.orders.find((o) => o.id === order.id);
      const product = order.productId ? state.products.find((p) => p.id === order.productId) : undefined;
      if (product && typeof product.quantityOnHand === "number") {
        const delta = reservationDelta(prev?.quantity, order.quantity);
        if (delta !== 0) {
          upsertProduct({ ...product, quantityOnHand: product.quantityOnHand + delta, updatedAt: new Date().toISOString() });
        }
      }
      dispatch({ type: state.orders.some((o) => o.id === order.id) ? "UPDATE_ORDER" : "ADD_ORDER", order });
      persistEntity("orders", order);
    },
```

Import `reservationDelta` at the top: `import { reservationDelta } from "../lib/inventory";`

In `deleteOrder`, release the reserved stock before removing:

```typescript
    deleteOrder: (orderId) => {
      const existing = state.orders.find((o) => o.id === orderId);
      const product = existing?.productId ? state.products.find((p) => p.id === existing.productId) : undefined;
      if (existing && product && typeof product.quantityOnHand === "number") {
        upsertProduct({ ...product, quantityOnHand: product.quantityOnHand + existing.quantity, updatedAt: new Date().toISOString() });
      }
      dispatch({ type: "DELETE_ORDER", orderId });
      if (cloud && user && !fromCloud.current) deleteEntity(user, "orders", orderId).catch(() => {});
    },
```

- [ ] **Step 6: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/StoreProvider.tsx
git commit -m "feat(provider): supplier/purchase CRUD + stock reservation on orders"
```

---

## Task 6: Cloud adapter + firestore rules

**Files:**
- Modify: `src/app/firebase/firestoreData.ts`
- Modify: `firestore.rules`

- [ ] **Step 1: Add suppliers/purchases to COLLECTIONS, forStores, loader, listeners**

In `firestoreData.ts`:
- `COLLECTIONS` array: add `"suppliers", "purchases"`.
- `forStores` union type: add `"suppliers" | "purchases"`.
- `loadCloudState` Promise.all: add `forStores<Supplier>("suppliers")` and `forStores<Purchase>("purchases")`.
- Return object: add `suppliers, purchases`.
- `registerEntityListeners` array: add `"suppliers", "purchases"`.

Add `Supplier, Purchase` to the type import.

- [ ] **Step 2: Add firestore rules**

In `firestore.rules`, after the `categories/{id}` block, add (mirroring it):

```
    match /suppliers/{id} {
      allow get: if isSignedIn() && isMember(resource.data.storeId);
      allow list: if isSignedIn();
      allow create, update, delete: if isSignedIn() && isMember(request.resource.data.storeId);
    }
    match /purchases/{id} {
      allow get: if isSignedIn() && isMember(resource.data.storeId);
      allow list: if isSignedIn();
      allow create, update, delete: if isSignedIn() && isMember(request.resource.data.storeId);
    }
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/firebase/firestoreData.ts firestore.rules
git commit -m "feat(cloud): suppliers/purchases collections + membership rules"
```

---

## Task 7: SuppliersScreen — light CRUD

**Files:**
- Create: `src/features/inventory/SuppliersScreen.tsx`

- [ ] **Step 1: Build the suppliers CRUD screen**

Mirror `CategoriesScreen.tsx` structure (list + Sheet form + delete). Create `src/features/inventory/SuppliersScreen.tsx`:

```typescript
import { useState } from "react";
import { useStore, newSupplier } from "../../app/StoreProvider";
import {
  Button, Card, EmptyState, ScreenHeader, Screen, Sheet,
  TextField, TextArea, IconButton, Dialog, useToast,
} from "../../design-system";
import { suppliersForStore } from "../../lib/selectors";
import type { Supplier } from "../../types";

export function SuppliersScreen({ onDone }: { onDone: () => void }) {
  const { state, activeStore, upsertSupplier, deleteSupplier } = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Supplier | null>(null);

  if (!activeStore) return null;
  const suppliers = suppliersForStore(state.suppliers, activeStore.id);

  return (
    <Screen wide>
      <ScreenHeader
        title="Proveedores"
        subtitle={`${suppliers.length} ${suppliers.length === 1 ? "proveedor" : "proveedores"}`}
        action={<Button onClick={() => setCreating(true)}>+ Agregar</Button>}
      />
      {suppliers.length === 0 ? (
        <EmptyState title="Sin proveedores" subtitle="Agrega los proveedores de quienes compras." icon={<div className="text-6xl">🤝</div>} />
      ) : (
        <div className="space-y-2">
          {suppliers.map((s) => (
            <Card key={s.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-ink truncate">{s.name || "Sin nombre"}</h3>
                  {s.contact && <p className="text-xs text-ink-soft truncate">{s.contact}</p>}
                </div>
                <div className="flex gap-1">
                  <IconButton variant="ghost" aria-label="Editar" onClick={() => setEditing(s)}>✎</IconButton>
                  <IconButton variant="ghost" aria-label="Eliminar" onClick={() => setDeleting(s)}>🗑</IconButton>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Sheet open={creating} onClose={() => setCreating(false)} title="Agregar proveedor">
        <SupplierForm supplier={newSupplier(activeStore.id)} onDone={() => setCreating(false)} />
      </Sheet>
      {editing && (
        <Sheet open onClose={() => setEditing(null)} title="Editar proveedor">
          <SupplierForm supplier={editing} onDone={() => setEditing(null)} />
        </Sheet>
      )}
      <Dialog open={deleting !== null} title="Eliminar proveedor" tone="danger"
        onClose={() => setDeleting(null)}
        footer={<>
          <Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => { if (deleting) { deleteSupplier(deleting.id); toast.success(`«${deleting.name}» eliminado`); } setDeleting(null); }}>Eliminar</Button>
        </>}>
        ¿Eliminar <span className="font-semibold text-ink">{deleting?.name}</span>?
      </Dialog>
    </Screen>
  );
}

function SupplierForm({ supplier, onDone }: { supplier: Supplier; onDone: () => void }) {
  const { upsertSupplier } = useStore();
  const [draft, setDraft] = useState<Supplier>(supplier);
  return (
    <div className="space-y-4">
      <TextField label="Nombre" placeholder="Ej. Platería GDL" value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
      <TextField label="Contacto" placeholder="Teléfono / donde encontrarlo" value={draft.contact ?? ""}
        onChange={(e) => setDraft({ ...draft, contact: e.target.value || undefined })} />
      <TextArea label="Notas" value={draft.notes ?? ""}
        onChange={(e) => setDraft({ ...draft, notes: e.target.value || undefined })} />
      <Button full size="lg" onClick={() => { if (!draft.name.trim()) return; upsertSupplier({ ...draft, name: draft.name.trim(), updatedAt: new Date().toISOString() }); onDone(); }}
        disabled={!draft.name.trim()}>Guardar proveedor</Button>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/features/inventory/SuppliersScreen.tsx
git commit -m "feat(inventory): suppliers CRUD screen"
```

---

## Task 8: PurchaseForm — multi-line ticket entry

**Files:**
- Create: `src/features/inventory/PurchaseForm.tsx`

- [ ] **Step 1: Build the purchase form**

This is the first repeating line-item form in the app. Create `src/features/inventory/PurchaseForm.tsx`:

```typescript
import { useState } from "react";
import { useStore, newPurchase } from "../../app/StoreProvider";
import {
  Button, SelectField, TextField, TextArea, IconButton, useToast,
} from "../../design-system";
import { suppliersForStore, productsForStore } from "../../lib/selectors";
import { applyPurchaseLines } from "../../lib/inventory";
import { todayIso } from "../../lib/dates";
import { formatMoney } from "../../lib/money";
import type { Purchase, PurchaseLine, Product } from "../../types";
import { uid } from "../../lib/ids";

export function PurchaseForm({ purchase, onDone }: { purchase: Purchase; onDone: () => void }) {
  const { state, activeStore, upsertPurchase, upsertProduct } = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Purchase>(purchase);

  if (!activeStore) return null;
  const suppliers = suppliersForStore(state.suppliers, activeStore.id);
  const products = productsForStore(state.products, activeStore.id);

  const subtotal = draft.lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  const delta = draft.totalConfirmed - subtotal;

  function addLine() {
    setDraft({ ...draft, lines: [...draft.lines, { productId: "", name: "", quantity: 1, unitCost: 0 }] });
  }
  function updateLine(idx: number, patch: Partial<PurchaseLine>) {
    setDraft({ ...draft, lines: draft.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) });
  }
  function removeLine(idx: number) {
    setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== idx) });
  }
  function pickProduct(idx: number, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (product) updateLine(idx, { productId, name: product.name, unitCost: product.cost ?? 0 });
    else updateLine(idx, { productId: "", name: "", unitCost: 0 });
  }

  function submit() {
    if (draft.lines.length === 0) { toast.error("Agrega al menos una pieza."); return; }
    if (draft.lines.some((l) => !l.productId)) { toast.error("Cada línea necesita un producto."); return; }
    const computed = applyPurchaseLines(
      products,
      draft.lines.filter((l) => l.productId)
    );
    // Apply stock + cost updates to each product.
    for (const [productId, update] of computed) {
      const p = state.products.find((x) => x.id === productId);
      if (p) upsertProduct({ ...p, quantityOnHand: update.quantityOnHand, cost: update.cost, updatedAt: new Date().toISOString() });
    }
    upsertPurchase({ ...draft, subtotal, updatedAt: new Date().toISOString() });
    toast.success(`Compra registrada: ${formatMoney(draft.totalConfirmed || subtotal)}`);
    onDone();
  }

  return (
    <div className="space-y-4">
      <SelectField label="Proveedor" value={draft.supplierId ?? ""}
        onChange={(v) => setDraft({ ...draft, supplierId: v || undefined })}
        options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        placeholder="Elegir proveedor…" />
      <TextField label="Fecha" type="date" value={draft.date}
        onChange={(e) => setDraft({ ...draft, date: e.target.value })} />

      <div>
        <span className="block text-xs font-semibold text-on-surface-soft uppercase tracking-wide mb-1.5">Piezas</span>
        <div className="space-y-2">
          {draft.lines.map((line, idx) => (
            <div key={idx} className="space-y-2 p-3 rounded-lg bg-surface-soft">
              <SelectField label="Producto" value={line.productId}
                onChange={(v) => pickProduct(idx, v)}
                options={products.map((p) => ({ value: p.id, label: `${p.name} (stock: ${p.quantityOnHand ?? 0})` }))}
                placeholder="Elegir producto…" />
              <div className="grid grid-cols-2 gap-2">
                <TextField label="Cantidad" inputMode="numeric" value={line.quantity.toString()}
                  onChange={(e) => updateLine(idx, { quantity: Math.max(1, parseInt(e.target.value) || 1) })} />
                <TextField label="Costo por pieza" inputMode="decimal" value={line.unitCost.toString()}
                  onChange={(e) => updateLine(idx, { unitCost: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-soft">Subtotal: {formatMoney(line.quantity * line.unitCost)}</span>
                <IconButton variant="ghost" aria-label="Quitar línea" onClick={() => removeLine(idx)}>✕</IconButton>
              </div>
            </div>
          ))}
        </div>
        <Button size="sm" variant="secondary" className="mt-2" onClick={addLine}>+ Agregar pieza</Button>
      </div>

      <div className="border-t border-edge pt-3 space-y-2">
        <div className="flex justify-between text-sm"><span className="text-ink-soft">Subtotal (suma de líneas)</span><span className="font-semibold text-ink">{formatMoney(subtotal)}</span></div>
        <TextField label="Total del ticket" hint="Lo que realmente pagaste. Si difiere del subtotal, te avisamos." inputMode="decimal"
          value={draft.totalConfirmed.toString()}
          onChange={(e) => setDraft({ ...draft, totalConfirmed: parseFloat(e.target.value) || 0 })} />
        {delta !== 0 && (
          <p className="text-xs text-terracotta">Diferencia de {formatMoney(Math.abs(delta))} ({delta > 0 ? "de más" : "de menos"}) — ¿envío, descuento o redondeo?</p>
        )}
      </div>

      <TextArea label="Notas" value={draft.notes ?? ""}
        onChange={(e) => setDraft({ ...draft, notes: e.target.value || undefined })} />

      <Button full size="lg" onClick={submit} disabled={draft.lines.length === 0}>Guardar compra</Button>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/features/inventory/PurchaseForm.tsx
git commit -m "feat(inventory): multi-line purchase form (ticket) with totals"
```

---

## Task 9: PurchaseList — history view

**Files:**
- Create: `src/features/inventory/PurchaseList.tsx`

- [ ] **Step 1: Build the purchase history list**

```typescript
import { useStore } from "../../app/StoreProvider";
import { Card, EmptyState, Badge, formatMoney } from "../../design-system";
import { purchasesForStore } from "../../lib/selectors";
import { formatMoney as fmt } from "../../lib/money";

export function PurchaseList({ onBack }: { onBack: () => void }) {
  const { state, activeStore } = useStore();
  if (!activeStore) return null;
  const purchases = purchasesForStore(state.purchases, activeStore.id)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="text-sm text-ink-soft">← Inventario</button>
      </div>
      {purchases.length === 0 ? (
        <EmptyState title="Sin compras registradas" subtitle="Registra tu primera compra con «+ Compra»." />
      ) : (
        purchases.map((p) => {
          const supplier = state.suppliers.find((s) => s.id === p.supplierId);
          return (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-ink truncate">{supplier?.name ?? "Sin proveedor"}</h3>
                  <p className="text-xs text-ink-soft">{p.date} · {p.lines.length} {p.lines.length === 1 ? "pieza" : "piezas"}</p>
                  <p className="text-xs text-ink-soft mt-1 truncate">
                    {p.lines.map((l) => `${l.quantity} ${l.name}`).join(", ")}
                  </p>
                </div>
                <Badge tone="neutral">{fmt(p.totalConfirmed || p.subtotal)}</Badge>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
```

Note: `formatMoney` is imported from the design-system barrel AND from `lib/money` — resolve this by importing only from `lib/money` (remove the design-system import of it). Fix: use `import { fmt }` alias from `lib/money` only, drop the `formatMoney` from the DS import.

- [ ] **Step 2: Fix the import and run typecheck**

The DS barrel does not export `formatMoney` — only `Money` (component) and `StatRow`. Remove it from the DS import. Final imports:

```typescript
import { useStore } from "../../app/StoreProvider";
import { Card, EmptyState, Badge } from "../../design-system";
import { purchasesForStore } from "../../lib/selectors";
import { formatMoney } from "../../lib/money";
```

And replace `fmt(...)` with `formatMoney(...)`.

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/features/inventory/PurchaseList.tsx
git commit -m "feat(inventory): purchase history list"
```

---

## Task 10: InventoryScreen redesign — Disponible/Comprometido/Físico + Compra button

**Files:**
- Modify: `src/features/inventory/InventoryScreen.tsx`

- [ ] **Step 1: Redesign the inventory screen**

Replace the screen body to show three values per product (Disponible / Comprometido / Físico) and add a "+ Compra" button + purchase list toggle. Rewrite `src/features/inventory/InventoryScreen.tsx`:

```typescript
import { useState } from "react";
import { useStore, newPurchase } from "../../app/StoreProvider";
import {
  Badge, Button, Card, EmptyState, IconButton, ScreenHeader, Screen, Sheet, StatRow, useToast,
} from "../../design-system";
import { productsForStore, committedForProduct } from "../../lib/selectors";
import { formatMoney } from "../../lib/money";
import { PurchaseForm } from "./PurchaseForm";
import { PurchaseList } from "./PurchaseList";

export function InventoryScreen() {
  const { state, activeStore, upsertProduct } = useStore();
  const toast = useToast();
  const [creatingPurchase, setCreatingPurchase] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  if (!activeStore) return null;
  const products = productsForStore(state.products, activeStore.id).filter(
    (p) => typeof p.quantityOnHand === "number"
  );

  function adjust(id: string, delta: number) {
    const p = state.products.find((x) => x.id === id);
    if (!p || typeof p.quantityOnHand !== "number") return;
    upsertProduct({ ...p, quantityOnHand: Math.max(0, p.quantityOnHand + delta), updatedAt: new Date().toISOString() });
  }

  if (showHistory) {
    return (
      <Screen>
        <ScreenHeader title="Compras" subtitle="Historial de compras a proveedores" />
        <PurchaseList onBack={() => setShowHistory(false)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Inventario" subtitle="Disponible / comprometido / físico"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowHistory(true)}>Compras</Button>
            <Button size="sm" onClick={() => setCreatingPurchase(true)}>+ Compra</Button>
          </div>
        }
      />
      {products.length === 0 ? (
        <EmptyState title="Sin inventario" subtitle="Agrega productos con existencia o registra una compra." icon={<div className="text-6xl">📦</div>} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {products.map((p) => {
            const available = p.quantityOnHand ?? 0;
            const committed = committedForProduct(state.orders, activeStore.id, p.id);
            const physical = available + committed;
            const low = typeof p.lowStockAt === "number" && available <= p.lowStockAt;
            return (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-ink truncate">{p.name}</h3>
                    <p className="text-xs text-ink-soft">Menudeo {formatMoney(p.prices?.retail)} · costo {formatMoney(p.cost)}</p>
                    {low && <div className="mt-1"><Badge tone="warning">Baja existencia</Badge></div>}
                    {available < 0 && <div className="mt-1"><Badge tone="danger">Faltan {Math.abs(available)}</Badge></div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <IconButton variant="secondary" onClick={() => adjust(p.id, -1)} aria-label="Restar uno">−</IconButton>
                    <span className="w-10 text-center text-xl font-extrabold text-ink">{available}</span>
                    <IconButton variant="primary" onClick={() => adjust(p.id, 1)} aria-label="Sumar uno">+</IconButton>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                  <StatRow label="Disponible">{available}</StatRow>
                  <StatRow label="Comprometido" tone={committed > 0 ? "warning" : "neutral"}>{committed}</StatRow>
                  <StatRow label="Físico">{physical}</StatRow>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Sheet open={creatingPurchase} onClose={() => setCreatingPurchase(false)} title="Nueva compra">
        <PurchaseForm purchase={newPurchase(activeStore.id)} onDone={() => setCreatingPurchase(false)} />
      </Sheet>
    </Screen>
  );
}
```

Note: confirm `StatRow` accepts plain number children (it renders `{children}` — if it expects a `Money` component, wrap accordingly). Check the DS `StatRow` signature; if it only takes `Money`, render text spans instead of `StatRow` for these integer counts.

- [ ] **Step 2: Verify StatRow usage + run typecheck**

Check `src/design-system/Money.tsx` for `StatRow`'s children type. If it's typed as `ReactNode`, the numbers work. If not, replace the three `<StatRow>` with plain `<div>` stat blocks. Run typecheck and fix accordingly.

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Run tests + build**

Run: `npm test && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/features/inventory/InventoryScreen.tsx
git commit -m "feat(inventory): disponible/comprometido/físico + compra entry"
```

---

## Task 11: Suppliers entry point — from StoreSettings

**Files:**
- Modify: `src/features/stores/StoreSettingsScreen.tsx`

- [ ] **Step 1: Add a "Proveedores" button in StoreSettings**

In `StoreSettingsScreen.tsx`, in the owner/admin section (near "Catálogo público" / "Catálogo → Prefijo de SKU"), add a button to open the SuppliersScreen in a Sheet:

```tsx
import { SuppliersScreen } from "../inventory/SuppliersScreen";
// ... in state: const [showSuppliers, setShowSuppliers] = useState(false);
// ... in the owner/admin block:
<Button full variant="secondary" onClick={() => setShowSuppliers(true)}>Proveedores</Button>
// ... at the bottom with the other sheets:
{showSuppliers && (
  <Sheet open onClose={() => setShowSuppliers(false)} title="Proveedores" size="lg">
    <SuppliersScreen onDone={() => setShowSuppliers(false)} />
  </Sheet>
)}
```

Note: confirm whether `Sheet` accepts a `size` prop — if not, omit it.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/features/stores/StoreSettingsScreen.tsx
git commit -m "feat(settings): proveedores entry point"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run the full gate**

Run: `npm run typecheck && npm run test && npm run build`
Expected: all PASS.

- [ ] **Step 2: Run the design-system gate explicitly**

Run: `npm test -- src/design-system/design-system-gate.test.ts`
Expected: PASS — no raw elements in features/app.

- [ ] **Step 3: Manual verification checklist**

- Create a supplier (Ajustes → Proveedores).
- Record a purchase with 2 lines (5 anillos @ $10, 3 collares @ $20) → stock + cost update.
- Verify inventory shows Disponible/Comprometido/Físico.
- Create an order for 2 anillos → Disponible drops by 2, Comprometido shows 2.
- Delete the order → stock restored.

- [ ] **Step 4: Commit + push**

```bash
git push
```

---

## Self-Review (post-write)

**Spec coverage:**
- ✅ Supplier entity (Task 3 types, Task 5 provider, Task 6 rules, Task 7 screen)
- ✅ Purchase entity with lines (Task 3, 5, 6, 8 form, 9 list)
- ✅ Weighted-average cost (Task 1, applied in Task 8)
- ✅ Cost history via purchase lines (each line stores unitCost — inherent)
- ✅ Stock reservation on order create (Task 2 delta, Task 5 wiring)
- ✅ Negative stock allowed (no floor in reservationDelta; InventoryScreen shows "Faltan N")
- ✅ Committed vs available vs physical (Task 2 committedForProduct, Task 10 UI)
- ✅ Inline product creation — **GAP**: the spec says "create a product inline from a purchase line", but Task 8's PurchaseForm only picks existing products. Add a sub-task or note.
- ✅ Suppliers CRUD (Task 7, 11)
- ✅ Firestore rules (Task 6)

**Gap found:** Inline product creation from a purchase line is in the spec but not in a task. This is a non-trivial UI addition (a mini product-create within the line). Recommendation: defer to a follow-up task or iteration — the purchase form works fully with existing products, and inline creation is an enhancement. Documented as a known gap.

**Type consistency:** `reservationDelta` (Task 2) used in Task 5 — name matches. `applyPurchaseLines` (Task 1) used in Task 8 — matches. `committedForProduct` (Task 2) re-exported in Task 4, used in Task 10 — matches. `newPurchase`/`newSupplier` (Task 5) used in Task 8/10/7 — matches.
