# Inventory purchase transactions + committed-stock

**Status:** Approved (2026-08-04)
**Branch:** TBD (off `codex/olivia-storefront`)

## Problem

Today inventory is a manual ±1 counter with no record of *why* stock changed, no purchase history, and no cost traceability. Ordering doesn't reserve stock. Fer cannot record a supplier purchase (a "ticket" of N line items) and see what she spent, and the product cost is a single overwritten value — so there's no way to know what a piece cost at a given time, which matters for margin analysis.

## Outcome

Fer can record each supplier purchase as a transaction (multiple line items, supplier, date, confirmed total). Each line replenishes a product's stock and updates its cost as a weighted average, keeping a full cost history in the transactions themselves. Creating an order reserves stock (subtracts on order-create, may go negative for back-orders). The inventory screen distinguishes available vs committed vs physical stock.

## Non-goals (this iteration)

- Margin/profitability analysis by period (the data is captured for future use, but no analytics UI now).
- Prorating a lump-sum cost across lines (Fer enters per-unit cost per line).
- Stock decrement on delivery (decrement happens at order-create instead).
- FIFO/LIFO costing (weighted average only).
- Supplier performance / lead-time analytics.

## Data model

### `Supplier` (new entity)

```ts
Supplier {
  id: string;
  storeId: string;
  name: string;
  contact?: string;   // phone / notes / where to find them
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
```

CRUD pattern mirrors `Category` (per-store, membership-gated by `storeId`). Listed/edited in a light screen reachable from the purchase form ("+ proveedor").

### `Purchase` (new entity — a supplier transaction / ticket)

```ts
type PurchaseLine = {
  productId: string;        // catalog product (created inline if new)
  name: string;             // snapshot at purchase time
  quantity: number;         // units bought
  unitCost: number;         // cost per unit (what Fer paid each)
};

Purchase {
  id: string;
  storeId: string;
  supplierId?: string;      // the supplier (optional)
  date: string;             // purchase date (default today)
  notes?: string;
  lines: PurchaseLine[];    // one or more line items
  subtotal: number;         // Σ quantity × unitCost (computed)
  totalConfirmed: number;   // the total Fer confirms (may differ from subtotal)
  createdAt: string;
  updatedAt: string;
}
```

`subtotal` is computed live in the form; `totalConfirmed` is what Fer enters/verifies. If they differ, the form flags the delta (rounding / shipping / discount) but accepts either.

The purchase lines **are** the cost history: each line records `unitCost` + the purchase `date` + `productId`, so future analysis can reconstruct any SKU's cost over time. No separate ledger entity.

### `Product` changes

- `cost?: number` — now recomputed as a **weighted average** when a purchase lands (see Costing). Read semantics unchanged (`OrderForm` snapshots it into the order at creation; `OrderCard` profit uses the snapshot).
- `quantityOnHand?: number` — semantics: **available** stock (physical minus reserved by open orders). Increased by purchases; decreased by order creation; manual ±1 still allowed for corrections.
- No new field on Product for the movement log — the log is the `Purchase` collection.

### `AppState`

Adds `suppliers: Supplier[]` and `purchases: Purchase[]` (same wiring pattern as `categories`: reducer actions, context methods, cloud adapter `COLLECTIONS`, `forStores`, listeners, seed, firestore rule, cascade on store-delete).

## Costing — weighted average

On purchase save, for each line, recompute the product's cost:

```
newCost = ((currentQtyOnHand × currentCost) + (lineQuantity × lineUnitCost))
          / (currentQtyOnHand + lineQuantity)
```

- If `currentCost` is undefined (first purchase), `newCost = lineUnitCost`.
- If `currentQtyOnHand` is 0 or negative, treat the existing stock contribution as 0 (the new purchase's unit cost becomes the cost).
- Write `newCost` and `currentQtyOnHand + lineQuantity` back to the product via `upsertProduct`.
- The line's `unitCost` is preserved in the `Purchase` (history) — the average is only the "current" value for new orders.

Because `Order.cost` is snapshotted at order creation (existing behavior), past orders keep their original cost; only new orders inherit the moving average. The live Catalog profit card (on-demand) reflects the current average — acceptable, and the only place that drifts.

## Stock reservation — order creation

When an order is created (`OrderForm.submit`), subtract `order.quantity` from the linked product's `quantityOnHand`:

- May go **negative** (back-order / encargo sin existencia). The OrderCard shortage badge already surfaces this.
- Editing an existing order's quantity must adjust the product stock by the delta.
- Deleting an order returns its quantity to stock.
- On-demand stores (`type: on_demand`) carry no `quantityOnHand` — reservation is skipped (no stock concept).

This replaces the "decrement on deliver" idea (decided against): reservation happens at order-create so the stock reflects committed pieces from the moment of the order.

## Committed vs available vs physical

The inventory screen shows three values per product:

- **Disponible (available)** = `quantityOnHand` (after reservation).
- **Comprometido (committed)** = Σ `quantity` of open (non-delivered, non-cancelled) orders for that product.
- **Físico (physical)** = available + committed (what's actually on the table).

A derived helper `committedForProduct(orders, storeId, productId)` computes the committed sum.

## UI

- **Inventory screen redesign:** three StatRows per product (Disponible / Comprometido / Físico) replacing the lone counter; the ±1 buttons remain for physical-count corrections.
- **"+ Compra" button** in the inventory screen → opens a Sheet with the purchase form (multi-line).
- **Purchase form:** supplier select (+ create), date, repeating line items (product select | create-inline | quantity | unit cost), live subtotal, total-confirmed field with delta flag, save.
- **Inline product creation:** in a line, if the product isn't in the catalog, a mini-form (name + retail price) creates it on the fly; the product is born with this purchase's quantity + cost.
- **Purchase list:** a view (within the inventory screen, toggled or a second sheet) listing purchases (supplier, date, lines, total) → detail. This is the history.
- **Suppliers CRUD:** light screen (like Categories) reachable from Ajustes de tienda and from the purchase form.

No new top-level routes required (everything lives in Inventario via Sheets). The navigation change (Catálogo submenu) is unaffected.

## Security / rules

- `suppliers/{id}` and `purchases/{id}` collections: membership-gated by `storeId`, mirroring `categories/{id}` (the template at `firestore.rules`). Anonymous-readable: NO (these are operational/private, unlike the public catalog projections).
- Cost/quantities are never written to public projections (leak-proof invariant preserved).

## Free-tier (CERO COSTOS) check

- New collections (`suppliers`, `purchases`) are private docs scoped to a store. A purchase is ~1 write per purchase + N `upsertProduct` writes (one per line) — comparable to editing N products. At Store OS scale (one owner, few members, dozens of products) this is far under the 20K writes/day free tier. No Functions, no extra reads on the public path.

## Acceptance criteria

- Fer can create a supplier, then a purchase with 2+ lines, and the stock + average cost of each line's product updates correctly.
- The inventory screen shows Disponible / Comprometido / Físico.
- Creating an order decrements the product's available stock; the OrderCard shortage badge reflects negatives.
- A product can be created inline from a purchase line.
- The purchase list shows the history with totals.
- Cost history is reconstructable from purchase lines.
- `typecheck && test && build` green; design-system gate clean; firestore.rules cover the new collections.

## Open / deferred

- Margin-by-period analytics (data captured, UI deferred).
- Cost-total proration across lines (Fer uses per-unit cost).
- Separate `/compras` route (not needed; lives in Inventario).
