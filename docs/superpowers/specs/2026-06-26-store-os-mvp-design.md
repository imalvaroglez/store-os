# Store OS — MVP Design (v1, local-first)

Date: 2026-06-26
Status: Approved (brainstorm)

## Context

`store-os` is a greenfield repo (empty except `.gitignore` + a 22-byte README). The
product brief is unusually prescriptive: it pins the stack (React + TS + Vite +
Tailwind + localStorage), the data models, the file tree, navigation, store types,
and acceptance criteria. This design therefore covers only the integration
decisions the brief leaves open, plus the build/verify path. Everything specified
in the brief is executed as written.

Store OS is a mobile-first, Spanish-only PWA for running small stores (on-demand
sellers and inventory-and-tiered-pricing businesses like jewelry). It feels like a
modern notebook, not an ERP/POS/CRM. Local-first in v1; the data layer is shaped so
Firebase can be added later without rewriting the UI.

## Decisions (resolved in brainstorm)

| Area | Decision |
|------|----------|
| Routing | Hand-rolled ~60-line history router (`pushState`/`popstate`). Routes: `/catalogo/:slug` (public) + admin shell with 5 tabs. No dependency. |
| State | Single `StoreProvider` = `useReducer` over all entities + `activeStoreId`. Components read via `useStore()`. **No component writes localStorage directly** — provider is the sole writer via the storage adapter. |
| Tests | Vitest on `lib/` (money, price/profit calc, store isolation, public-catalog filtering). `tsc --noEmit` type gate + `npm run build`. No component/DOM tests in v1. |
| PWA | Installable + offline: `manifest.webmanifest` + maskable icon + a minimal service worker registered via `src/pwa.ts`. |
| Seed | Two demo stores (Santi on-demand, Joyería inventory-tiered) + demo products/customers/orders auto-seeded on first load (no `STORE_OS` key). A small "Reset demo data" affordance wipes to a fresh seed. |

## Architecture

```
src/
  app/
    App.tsx            # root: route branch (public vs admin) + StoreProvider
    AppShell.tsx       # admin layout: StoreSwitcher + screen + BottomNav
    StoreProvider.tsx  # useReducer over AppState; sole localStorage writer
    router.ts          # tiny history router: useRoute() -> { name, params }
  components/          # BottomNav, Card, Button, EmptyState, Money, FormField, StoreSwitcher
  features/
    stores/            # StoresScreen, StoreForm  (incl. empty state + reset)
    home/              # HomeScreen — "¿Qué necesito hacer hoy?"
    catalog/           # CatalogScreen, ProductForm (adapts to store type), PublicCatalogScreen
    customers/         # CustomersScreen, CustomerForm
    orders/            # OrdersScreen, OrderForm (adapts to store type), OrderCard, orderStatus.ts
    inventory/         # InventoryScreen (inventory-tiered only; ±1 quick adjust)
  lib/
    ids.ts money.ts dates.ts storage.ts whatsapp.ts seed.ts
    router.ts          # route matching helpers (shared)
  types/index.ts       # Store, Product, Customer, Order + enums (verbatim from brief)
  pwa.ts               # registers service worker (dev-gated)
public/
  manifest.webmanifest, sw.js, icons
```

Root-level config: `package.json`, `tsconfig.json`, `vite.config.ts`,
`tailwind.config.js`, `postcss.config.js`, `index.html`, `vitest.config.ts`.

## Data flow

```
tap -> dispatch(action) -> reducer -> new AppState -> effect: storage.saveState(s) -> re-render
```

Public catalog (`/catalogo/:slug`) reads the same AppState, filters
`products.filter(p => p.storeId === store.id && p.isPublic)`, renders only
name/image/description/price. WhatsApp CTA via
`createWhatsAppProductUrl(product, store)`.

## Data model

Verbatim from the brief: `Store`, `Product`, `Customer`, `Order` with their enums
(`StoreType`, `ProductCategory`, `OrderStatus`, price tier). Rules respected:
`price` for on-demand, `prices` for inventory-tiered, `quantityOnHand` only on
inventory-tiered. Forms adapt by store type — never force fields.

## Error handling & validation (trust boundaries)

- Numeric form inputs (cost/price/qty/deposit/tier prices) are coerced:
  empty -> `undefined` (or `0` for deposit/qty); never write `NaN`.
- Store isolation enforced at the reducer (actions carry `storeId`) and verified
  by a unit test.
- All money goes through `lib/money.ts` — one place for MXN formatting.

## Verification

- `npm install && npm run dev` — manual smoke against the brief's 13-step
  validation list (create/switch stores, isolation, product/customer/order CRUD,
  order status advance, persistence across refresh, public catalog per store with
  private fields hidden, mobile viewport).
- `npm run build` must pass.
- `npm run typecheck` (`tsc --noEmit`) must pass.
- `npm test` — Vitest on `lib/`: money format, price/profit calc, store isolation,
  public-catalog filtering.

## Intentionally not built (brief Out of Scope)

Auth, Firebase/sync, real image uploads (URL only), payments/checkout/cart,
invoices, suppliers, barcode/SKU, inventory movement ledger, analytics, complex
roles. Public catalog is local-only — no pretense of global shareability.

## Known limitations (v1)

- No cloud sync / no cross-device. Data lives in one browser's localStorage.
- Public catalog is reachable by URL but only meaningful on the same device/store.
- No image upload; URL only.
- Inventory adjustment is manual ±1; no automatic stock deduction on order.
