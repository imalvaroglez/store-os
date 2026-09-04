# Arquitectura — Store OS

Documento de referencia para entender cómo está construido Store OS. Para procesos y decisiones, ver los specs en `docs/superpowers/specs/`.

## Visión general

App de una sola página (SPA) **Firebase-first**, renderizada con React + TypeScript + Vite, estilada con Tailwind sobre un sistema de tokens. Los datos operativos viven en Firebase. `localStorage` se reserva para preferencias, carrito y el adaptador de estado usado por pruebas unitarias; nunca es un respaldo de datos de negocio en ejecución.

```
src/
  app/            # raíz: App, AppShell (responsive), StoreProvider (estado), router
  design-system/  # sistema de diseño (tokens + primitivos + gate) y theme/
  features/       # pantallas por dominio
  lib/            # utilidades puras (ids, money, dates, storage, selectors, whatsapp, labels, router)
  types/          # modelo de datos
```

## Modelo de datos (`src/types/index.ts`)

- **`Store`** — `id`, `name`, `slug`, `type: "on_demand" | "inventory_tiered"`, `whatsappPhone?`, timestamps. El `super_admin` puede leer y editar el documento completo de cualquier tienda; los miembros sólo el de sus tiendas.
- **`Product`** — `storeId`, `name`, `category`, `imageUrl?`, `isPublic`, y según el tipo de tienda:
  - on-demand: `price?` (precio único) + `cost?`.
  - inventory-tiered: `prices?: { retail?, wholesale?, reseller? }` + `quantityOnHand?` + `lowStockAt?`.
  - Además: `publicDescription?`, `privateNotes?`.
- **`Customer`** — `storeId`, `name`, `phone?`, `notes?`.
- **`Order`** — `storeId`, `customerId`, `productName` (+ `productId?`), `quantity`, `price`, `deposit`, `status` (7 valores), `cost?`, `priceTier?`, `promisedDate?`, `notes?`.
- **`AppState`** — `{ stores, activeStoreId, products, customers, orders }`. En ejecución se sincroniza con las colecciones de Firebase; el adaptador completo de `localStorage` sólo existe para pruebas unitarias.

**Reglas:**
- `price` es para tiendas on-demand; `prices` para inventory-tiered. No se fuerzan campos según el tipo.
- `quantityOnHand` solo aplica a inventory-tiered.

## Flujo de estado y persistencia

```
tap → dispatch(action) → reducer (StoreProvider) → Firebase
    → React re-renderiza con el estado sincronizado
```

- **`StoreProvider`** (`src/app/StoreProvider.tsx`) mantiene el estado de UI en un `useReducer` y delega las escrituras operativas a Firebase cuando hay sesión. Expone `useStore()` con acciones (`addStore`, `upsertProduct`, `upsertOrder`, `advanceStatus`, `adjustInventory`, etc.).
- **Ningún componente llama a `localStorage` directamente**. `src/lib/storage.ts` conserva únicamente preferencias/carrito y el adaptador completo para pruebas unitarias.
- **Aislamiento entre tiendas:** las pantallas nunca filtran `state.products` directo; usan selectores (`productsForStore`, `ordersForStore`, etc. en `src/lib/selectors.ts`) que filtran por `storeId`.
- **Datos de prueba:** `npm run seed:dev` publica datos explícitamente en el proyecto Firebase real `store-os-dev`. La aplicación no siembra ni restaura datos por su cuenta.

### Acceso de plataforma y aislamiento

- `super_admin` es un rol privilegiado de plataforma con acceso operativo global a las tiendas actuales y a sus datos de operación: productos, categorías, proveedores, compras, clientes, pedidos, inventario, costos, fotos y configuración de WhatsApp.
- `member` opera sólo las tiendas incluidas en `memberUids`; `ownerUid` conserva los controles específicos de dueña, como miembros, transferencia y eliminación.
- `adminStores` sigue siendo la fuente canónica para membresía y propiedad. No es una vista limitada del superadmin: es el plano de control que las reglas consultan, mientras `stores` contiene el documento de negocio que el superadmin necesita para operar.
- El acceso privado global del superadmin no cambia la proyección pública: `publicStores`, `publicCatalogs` y `publicProducts` siguen usando allow-lists y nunca exponen costos, notas privadas, inventario exacto ni membresías.
- La decisión completa y sus límites están en [`ADR 0003`](adr/0003-platform-super-admin-access.md).

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

## Ambientes y pruebas

- **Unit (`vitest`):** funciones puras, reducer, selectores, render de primitivos, inyección de temas y el **gate** del sistema de diseño. No prueban Firebase.
- **Integración/reglas (`npm run test:rules`):** usa el SDK Admin sólo para preparar y limpiar datos temporales reales en `store-os-dev`; las comprobaciones pasan por el SDK cliente y las reglas desplegadas en ese mismo proyecto.
- **E2E (`npm run e2e:dev`):** levanta la aplicación local y llama al backend real de `store-os-dev` (incluidas callable functions). Usa un tenant de pruebas dedicado y elimina sus documentos al terminar.
- No hay emuladores ni un modo demo. Consulta [`ENVIRONMENTS.md`](ENVIRONMENTS.md) para el contrato obligatorio y la promoción a producción.

## Diseñado para cambiar

- **Persistencia:** Firebase ya es el adaptador operativo; `src/lib/storage.ts` no debe convertirse en un fallback de negocio.
- **Auth/roles:** `StoreProvider` es el lugar natural para leer el usuario y filtrar tiendas por membresía.
- **Temas:** agregar un tema es un nuevo archivo en `theme/` que exporte el mismo `Theme`.
