# Arquitectura — Store OS

Documento de referencia para entender cómo está construido Store OS. Para procesos y decisiones, ver los specs en `docs/superpowers/specs/`.

## Visión general

App de una sola página (SPA) **local-first**, renderizada con React + TypeScript + Vite, estilada con Tailwind sobre un sistema de tokens. Todo el estado vive en el navegador (`localStorage`); no hay backend todavía.

```
src/
  app/            # raíz: App, AppShell (responsive), StoreProvider (estado), router
  design-system/  # sistema de diseño (tokens + primitivos + gate) y theme/
  features/       # pantallas por dominio
  lib/            # utilidades puras (ids, money, dates, storage, selectors, whatsapp, seed, labels, router)
  types/          # modelo de datos
```

## Modelo de datos (`src/types/index.ts`)

- **`Store`** — `id`, `name`, `slug`, `type: "on_demand" | "inventory_tiered"`, `whatsappPhone?`, timestamps.
- **`Product`** — `storeId`, `name`, `category`, `imageUrl?`, `isPublic`, y según el tipo de tienda:
  - on-demand: `price?` (precio único) + `cost?`.
  - inventory-tiered: `prices?: { retail?, wholesale?, reseller? }` + `quantityOnHand?` + `lowStockAt?`.
  - Además: `publicDescription?`, `privateNotes?`.
- **`Customer`** — `storeId`, `name`, `phone?`, `notes?`.
- **`Order`** — `storeId`, `customerId`, `productName` (+ `productId?`), `quantity`, `price`, `deposit`, `status` (7 valores), `cost?`, `priceTier?`, `promisedDate?`, `notes?`.
- **`AppState`** — `{ stores, activeStoreId, products, customers, orders }`. Es lo que se persiste entero.

**Reglas:**
- `price` es para tiendas on-demand; `prices` para inventory-tiered. No se fuerzan campos según el tipo.
- `quantityOnHand` solo aplica a inventory-tiered.

## Flujo de estado y persistencia

```
tap → dispatch(action) → reducer (StoreProvider) → nuevo AppState
    → effect: storage.saveState(state)   ← único escritor de localStorage
    → React re-renderiza
```

- **`StoreProvider`** (`src/app/StoreProvider.tsx`) mantiene todo en un `useReducer`. Expone `useStore()` con acciones (`addStore`, `upsertProduct`, `upsertOrder`, `advanceStatus`, `adjustInventory`, `resetDemo`, etc.).
- **Ningún componente llama a `localStorage` directamente** — solo `src/lib/storage.ts`, invocado por el provider. Esto aísla la persistencia para poder cambiarla (ej. Firebase) sin tocar la UI.
- **Aislamiento entre tiendas:** las pantallas nunca filtran `state.products` directo; usan selectores (`productsForStore`, `ordersForStore`, etc. en `src/lib/selectors.ts`) que filtran por `storeId`.
- **Seed:** en la primera carga (sin `store_os_state_v1` en `localStorage`) se siembran dos tiendas demo (Santi on-demand, Joyería inventory-tiered) con productos/clientes/pedidos.

## Sistema de diseño (`src/design-system/`)

Un solo barrel (`index.ts`) es la **única** superficie de importación de UI. Primitivos: `Button`/`IconButton`, `Card`, `Badge`, `Money`/`StatRow`, `ScreenHeader`, `EmptyState`, `Sheet`/`useEntitySheet`, `ProductImage`, `BottomNav`, `Sidebar`, `Screen`, `StoreSwitcher`, y la familia `FormField` (`TextField`/`TextArea`/`CheckboxField`/`SelectField`).

- **Tokens:** `tokens.ts` (tonos de estatus → clases), más variables CSS (`--paper`, `--ink`, `--terracotta`, `--surface`, `--on-surface`, `--danger`, `--success`, radios, sombras) definidas en `index.css` y el tema activo. Tailwind (`tailwind.config.js`) mapea sus colores a esas variables, así `bg-paper`/`text-on-surface`/etc. se adaptan al tema.
- **Gate de cumplimiento** (`design-system-gate.test.ts`): falla si `src/features/**` o `src/app/**` usan `<button>`/`<select>`/`<input>` crudos o importan primitivos de fuera del barrel. Es la regla "toda la UI pasa por el sistema de diseño, sin excepciones".

## Sistema de temas (`src/design-system/theme/`)

Cada tema (`paper`, `maximalist`, `luxury`) es una **personalidad completa**: colores, tipografía, radios, sombras y **movimiento**. `ThemeProvider` inyecta los tokens del tema activo en `<html data-theme="…">` (más fuentes y keyframes); al cambiar de tema, todo se restyla automáticamente porque los primitivos leen de variables.

- Persiste en `localStorage["store_os_theme"]`; cuando exista auth, pasará al perfil del usuario en Firestore sin tocar la UI.
- Respeta `prefers-reduced-motion` (amortigua animaciones).
- **Paper Ledger** es el default y reproduce exactamente el look original (baseline de regresión).

## Routing

Router de historia mínimo y sin dependencias (`src/lib/router.ts` + hook `useRoute` en `src/app/router.ts`). `navigate(path)` hace `pushState` + `popstate` sintético.

- `/catalogo/:slug` → catálogo público (vista completa, sin shell, sin datos privados).
- Cualquier otra ruta → admin shell, donde el primer segmento mapea a un tab (`/`, `/catalogo-admin`, `/pedidos`, `/clientes`, `/inventario`).
- `appType: "spa"` en Vite para fallback a `index.html` en recargas de rutas profundas.

## Layout responsive (`src/app/AppShell.tsx`)

- **Móvil (`< md`):** header superior (switcher de tienda + ajustes) + contenido scrollable + bottom nav.
- **Escritorio (`≥ md`):** `Sidebar` fija (marca, switcher, navegación, ajustes) + contenido con cuadrículas multi-columna.
- `navItems.ts` es la fuente única de navegación, compartida por `BottomNav` y `Sidebar`.
- `Sheet` es responsive: bottom-sheet en móvil, modal centrado en escritorio.

## Pruebas

- **Unit (`vitest`):** `lib/money` (formato, profit, parseo), `lib/selectors` (aislamiento por tienda, filtrado del catálogo público), render de primitivos, inyección de temas, y el **gate** del sistema de diseño.
- **E2E (`playwright`), dos proyectos:** móvil (390×844) y escritorio (1280×800). Cubren el flujo completo (crear tienda/producto/cliente/pedido, avanzar estatus, persistencia, catálogo público) + responsividad + cambio de temas.

## Diseñado para cambiar

- **Persistencia:** cambiar `src/lib/storage.ts` por un adaptador async (Firestore) no afecta al reducer ni a la UI.
- **Auth/roles:** `StoreProvider` es el lugar natural para leer el usuario y filtrar tiendas por membresía.
- **Temas:** agregar un tema es un nuevo archivo en `theme/` que exporte el mismo `Theme`.
