# Arquitectura — Store OS

Documento de referencia para entender cómo está construido Store OS. Para procesos y decisiones, ver los specs en `docs/superpowers/specs/`.

## Visión general

App de una sola página (SPA) renderizada con React + TypeScript + Vite y Tailwind sobre un sistema propio de tokens. Firebase Auth y Firestore son la fuente de verdad para toda la administración. `localStorage` se reserva para preferencias, carrito público y borradores asociados a una persona autenticada.

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
- **`AppState`** — `{ stores, activeStoreId, products, customers, orders }`. Es el estado de interfaz derivado de Firebase; no se persiste como un documento local completo.

**Reglas:**
- `price` es para tiendas on-demand; `prices` para inventory-tiered. No se fuerzan campos según el tipo.
- `quantityOnHand` solo aplica a inventory-tiered.

## Flujo de estado y persistencia

```
Firebase Auth → usuario autenticado → StoreProvider → Firestore
                                      └→ estado de interfaz en memoria
                                      └→ borradores autenticados en localStorage
Catálogo público → proyección pública de Firebase (lectura anónima)
```

- **`StoreProvider`** (`src/app/StoreProvider.tsx`) mantiene en memoria el estado de interfaz y lee/escribe datos administrativos mediante el adaptador Firestore de `src/app/firebase/`.
- **Estado de transición:** la rama actual aún conserva una ruta heredada de carga y guardado administrativo local en `src/lib/storage.ts`. No es una arquitectura admitida ni debe ampliarse; su eliminación está bloqueada y especificada en [`eradicate-local-mode`](superpowers/specs/2026-10-30-eradicate-local-mode-design.md).
- **Persistencia legítima del navegador:** carrito público por tienda, preferencias, tema y borradores de pedido vinculados a una cuenta autenticada. La limpieza futura elimina únicamente el estado administrativo heredado `store_os_state_v1`, no todo `localStorage`.
- **Aislamiento entre tiendas:** las pantallas nunca filtran `state.products` directo; usan selectores (`productsForStore`, `ordersForStore`, etc. en `src/lib/selectors.ts`) que filtran por `storeId`.
- **Datos iniciales:** no se crean tiendas ficticias al abrir la app. El script `scripts/seed-dev.cjs` prepara datos de trabajo únicamente en `store-os-dev`.

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

- Persiste por usuaria en el perfil de Firestore; `localStorage` puede conservar una copia de la preferencia para una carga inmediata, nunca habilita administración sin sesión.
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

## Límites entre capas

- **Autenticación:** `AuthProvider` observa la sesión de Firebase y protege las rutas privadas.
- **Datos cloud:** `firestoreData.ts` contiene las lecturas y escrituras; las reglas de Firestore aplican el aislamiento por tienda.
- **Estado de interfaz:** `StoreProvider` coordina los cambios visibles y las operaciones administrativas de Firestore. La ruta heredada de persistencia local sigue pendiente de erradicación como P0; no se debe ampliar.
- **Temas:** cada tema es un archivo en `src/design-system/theme/` que implementa el mismo tipo `Theme`.
