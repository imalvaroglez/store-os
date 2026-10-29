# Arquitectura — Store OS

Documento de referencia para entender cómo está construido Store OS. Para procesos y decisiones, ver los specs en `docs/superpowers/specs/`; para el roadmap financiero vigente, el plan técnico de Olivia (sesión 2026-10-28).

## Visión general

PWA **mobile-first** en español (México): SPA de React 18 + TypeScript + Vite, estilada con Tailwind sobre un sistema de tokens propio. Dos modos de operación tras iniciar sesión:

- **Modo demo (sin sesión):** todo el estado vive en `localStorage`; `StoreProvider` es el único escritor.
- **Modo cloud (con sesión):** Firestore en colecciones raíz + Firebase Auth (email/password y Google) + Cloud Storage para imágenes y PDFs; despliegue en Vercel.

```
src/
  app/            # App, AppShell (responsive), StoreProvider (estado), router, firebase/
  design-system/  # sistema de diseño (tokens + primitivos + gate) y theme/
  features/       # pantallas por dominio (catalog, orders, customers, inventory, stores, home)
  lib/            # utilidades puras (money, pricing, inventory, orders, selectors, whatsapp, dates, cart…)
  types/          # modelo de datos (index.ts)
functions/        # Cloud Functions (por ahora: OCR de PDFs de compra)
scripts/          # seed dev, prerender, guards de build/reglas, ensayo del Excel
```

### Ambientes

Dos backends Firebase aislados: **`store-os-dev`** (local + Preview/Vercel) y **`store-os-f7cf8`** (producción). `scripts/check-env.cjs` falla el build si un ambiente apunta al backend equivocado. Las reglas se despliegan en cada push a `main` (CI) con verificación de paridad (`scripts/check-rules-deployed.cjs`). Ver `docs/DEPLOYMENT.md`.

## Modelo de datos (`src/types/index.ts`)

Todas las entidades de negocio viven en colecciones raíz y llevan `storeId`:

- **`Store`** — `type: "on_demand" | "inventory_tiered"`, `priceTiers?: PriceTierDef[]` (IDs estables, labels editables; para Olivia: Regular/Girly/Iconic), `defaultTierId`, `pricingRule` (markup sugerido), `whatsappPhone`, `storefront`, membresía (`ownerUid`, `memberUids`, `pendingInvites`). **`AdminStore`** (`adminStores`) es el plano de control paralelo con la membresía canónica.
- **`Product`** — `prices?: Record<tierId, number>` (tiered) o `price?` (on-demand), `cost?` (promedio ponderado), `quantityOnHand?`, `lowStockAt?`, `sku?`, `slug?`, `categoryIds?`, `status` (draft/published/archived), `availability`, galería `images[1..5]`, `material/finish`, `privateNotes`, `schemaVersion`.
- **`Category`** — privada por tienda, plana (máx. 3 por producto), con imagen e `sortOrder`.
- **`Customer`** — `name`, `phone?`, `instagram?`, `notes?`. (Segmento/nivel por clienta: en camino — plan E2.)
- **`Order` (order-v2, `schemaVersion: 2`)** — `items: OrderItem[]` con snapshot por línea (`productName`, `unitPrice`, `priceTier`, `cost?`, `quantity`), totales **derivados** (`orderTotals`), `deposit` (anticipo escalar), `orderStatus` (`asked→quoted→confirmed→preparing→ready→delivered` + `cancelled`), `paymentStatus` derivado (unpaid/partial/paid).
- **`Supplier` / `Purchase`** — compra con `lines: PurchaseLine[]` (`productId`, `quantity`, `unitCost`, importes de PDF OCR con `sourceAmountType`), `subtotal`/`totalConfirmed`, `discount/shipping/tax`, `status` (`draft→needs_review→ready→received`), `documentPath` (PDF), `origin` (manual/pdf). **Una compra recibida es inmutable** (reglas + UI).
- **Proyecciones públicas** — `publicStores`, `publicCatalogs`, `publicProducts` (allow-list; nunca exponen costos, notas ni inventario exacto — solo señal coarse de stock), `slugs` (reserva global), `users` (perfil + rol).

**AppState** (memoria): `{ stores, products, categories, suppliers, purchases, customers, orders }` + `activeStoreId`. En demo se persiste entero en `localStorage`; en cloud se carga por tiendas accesibles.

## Flujo de estado y persistencia

```
tap → dispatch(action) → reducer (StoreProvider) → nuevo AppState
  demo:  → storage.saveState(state)          ← único escritor de localStorage
  cloud: → firestoreData.saveEntity(…)       ← escrituras por entidad
          → saveOrderWithStockTx / receivePurchaseTx   ← batch/transacción con stock+costo
```

- **`StoreProvider`** (`src/app/StoreProvider.tsx`) mantiene todo en un `useReducer` y expone `useStore()`; `cloud` es `true` con sesión activa.
- **`firestoreData.ts`** acota lecturas a tiendas accesibles (`where memberUids array-contains` / `storeId in`), mantiene listeners con debounce y proyecta lo público al guardar.
- Escrituras atómicas relevantes: `saveOrderWithStockTx` (pedido + stock en un batch) y `receivePurchaseTx` (recepción + costo promedio ponderado, idempotente por `receivedAt`).
- **Aislamiento entre tiendas:** las pantallas usan selectores (`src/lib/selectors.ts`) y las reglas de Firestore hacen cumplir `canOperateStore(resource.data.storeId)` por documento.
- Dinero: `src/lib/money.ts` (`parseAmount` evita NaN; `formatMoney` entero, `formatMoneyExact` con centavos). Costos: `src/lib/inventory.ts` (promedio ponderado; reservas: pedidos abiertos y entregados retienen stock).

### Acceso de plataforma y aislamiento

- `super_admin` es un rol privilegiado de plataforma con acceso operativo global a las tiendas actuales y a sus datos de operación; sin PII de clientas fuera del plano de datos.
- `member` opera sólo las tiendas en `memberUids`; `ownerUid` conserva controles de dueña (miembros, transferencia, eliminación).
- `adminStores` es el plano de control canónico que las reglas consultan; `stores` es el documento de negocio.
- El acceso global del superadmin no cambia la proyección pública: `publicStores`/`publicCatalogs`/`publicProducts` usan allow-lists. Decisión completa en [`ADR 0003`](adr/0003-platform-super-admin-access.md).

## Backend

- **Cloud Functions (`functions/`):** una callable — `importPurchasePdf` (OCR con mupdf + tesseract.js, región `us-east1`) que parsea PDFs de pedidos de proveedor ya subidos a Storage y devuelve líneas para la pantalla de revisión. No escribe Firestore. Restricción dura del proyecto: **cero costos** (free tier); nada de schedulers/servicios con cobro.
- **Cloud Storage:** `products/{storeId}/…`, `categories/{storeId}/…` (lectura pública, imágenes), `purchases/{storeId}/…` (PDFs, sólo miembros, sin update), `storefront/{storeId}/…` (sólo owner). Reglas en `storage.rules` con membresía vía `firestore.get()` cross-service.
- **Seguridad:** `firestore.rules` (aislamiento por tienda, anti-spoofing de `users`, invitaciones auto-reconciliadas, inmutabilidad de compras recibidas) probadas contra el emulador (`npm run test:rules`, garantías G-P01–G-P06+). Sin telemetría cliente (gate en tests).

## Catálogo público

- Rutas públicas sin cuenta: `/catalogo/:slug` (Olivia tiene storefront editorial propio con hero, categorías, búsqueda, FAQ y bloque de reventa), `/catalogo/:slug/categoria/:cSlug` y `/catalogo/:slug/producto/:pSlug`.
- Carrito público (`useCart` + `CartDrawer`): selección persistida por slug en el navegador, progresión informativa de niveles y envío del pedido por **deep-link de WhatsApp** (`src/lib/whatsapp.ts`). No hay checkout ni pagos.
- SEO/prerender en build (`scripts/prerender-public.mjs`) y gate anti-SDK en el bundle público (`scripts/check-public-bundle.mjs`).

## Sistema de diseño (`src/design-system/`)

Un solo barrel (`index.ts`) es la única superficie de importación de UI. Primitivos: `Button`/`IconButton`, `Card`, `Badge`, `Money`/`StatRow`, `ScreenHeader`, `EmptyState`, `Sheet`/`useEntitySheet`, `ProductImage`, `BottomNav`, `Sidebar`, `Screen`, `StoreSwitcher`, familia `FormField`.

- **Tokens:** variables CSS (`--paper`, `--ink`, `--surface`, `--on-surface`, `--danger`, `--success`, radios, sombras) que Tailwind mapea; los primitivos se adaptan al tema activo.
- **Gate de cumplimiento** (`design-system-gate.test.ts`): falla si `src/features/**` o `src/app/**` usan `<button>`/`<select>`/`<input>` crudos o importan primitivos fuera del barrel.

## Sistema de temas (`src/design-system/theme/`)

Cada tema (`paper`, `maximalist`, `luxury`) define colores, tipografía, radios, sombras y movimiento. `ThemeProvider` inyecta tokens en `<html data-theme>`; persiste en `localStorage` y en el perfil Firestore del usuario. Respeta `prefers-reduced-motion`. **Paper Ledger** es el default (baseline de regresión).

## Routing y layout

Router de historia mínimo sin dependencias (`src/lib/router.ts` + `useRoute`). Rutas admin: `/` (inicio), `/productos` (+ `/categorias`, `/compras`), `/pedidos` (+ `/nuevo`, `/:id`), `/clientes`, `/tienda/configuracion`. **Móvil (`< md`):** header + bottom nav; **escritorio:** `Sidebar` fija + cuadrículas multi-columna. `Sheet` es bottom-sheet en móvil y modal en escritorio.

## Pruebas

- **Unit + gates (`vitest`, `npm run test`):** money, pricing, inventory (costo ponderado, reservas), purchases lifecycle (idempotencia, inmutabilidad), orders, cart, whatsapp, selectors, ensayo del Excel, gate del design system, gates de seguridad/telemetría.
- **Reglas Firestore (`npm run test:rules`):** emulador; aislamiento multitienda, superadmin, anti-enumeración pública, invariante `storeId`, anti-spoofing, invitaciones.
- **E2E (`playwright`, 3 suites):** smoke responsive (móvil+escritorio), firebase (auth, tiendas, invitaciones, subida de fotos, compras 50 líneas, función OCR), refresh (service worker tras deploy), telemetry-egress.
- **CI (`.github/workflows/ci.yml`):** typecheck → tests → build → rules → e2e → deploy Vercel (Preview/Production) + deploy de reglas con paridad.

## Limitaciones conocidas y dirección (2026-10)

El plano financiero (cobros granulares, gastos, prorrateos, períodos, cierres, reparto 20/50/30, migración del Excel) **no existe todavía**: `Order.deposit` es un escalar y `profit()` es estimativo. El diagnóstico y el plan incremental (entregas E0–E12) viven en la sesión del 2026-10-28; el ensayo reproducible del Excel en `docs/excel-trial-2026-10-28.md` y las decisiones pendientes en `docs/olivia-decisiones-fer-2026-10-28.md`.
