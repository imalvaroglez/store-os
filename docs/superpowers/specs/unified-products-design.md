---
Delivery-ID: unified-products
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/unified-products-design.md
---
# Diseño unificado de productos

## Problema / Causa raíz (verificada en código)

Hoy el admin tiene **dos paths independientes para editar los mismos campos del producto**, creando confusión y fricción:

1. **Catálogo → Productos** (`CatalogScreen.tsx`): muestra el formulario `ProductForm.tsx` con todos los campos del producto (`src/features/catalog/ProductForm.tsx:418-446` editan `cost`, `prices`, `quantityOnHand`, `lowStockAt`).
2. **Inventario → + Compra** (`InventoryScreen.tsx` + `PurchaseForm.tsx`): el flujo de compra también edita `cost` y `prices` inline (`src/features/inventory/PurchaseForm.tsx:188-215`), y actualiza `quantityOnHand` vía `applyPurchaseLines()`.

**El problema es de navigation, no de datos:** `ProductForm` **YA EDITA** stock, costo y precios (verificado). No necesitamos cambiar el modelo de datos ni duplicar lógica.

## Objetivo

Consolidar la administración de productos en **una sola pestaña "Productos"** que contiene:

1. La lista de productos (ahora en CatalogScreen)
2. Categorías (ahora en `/catalogo-admin/categorias`)
3. Compras (ahora accesibles desde Inventario)

## Alcance (in)

1. **Renombrar el grupo de navegación** "Catálogo" → "Productos" (`/catalogo-admin` → `/productos`), con el padre renderizando la lista (patrón actual, sin pantalla wrapper nueva)
2. **Mover Categorías dentro de Productos** como hijo del nav (`/productos/categorias`)
3. **Extraer la vista de Compras** de `InventoryScreen` a su propia pantalla `/productos/compras` (lista + "+ Compra" + Sheet de `PurchaseForm`)
4. **Eliminar la pestaña "Catálogo"** del navigation (`src/design-system/navItems.ts:21-28`)
5. **Retirar `InventoryScreen` y su pestaña por completo**: en stores `inventory_tiered`, las tarjetas de producto de la lista (`CatalogScreen`) pasan a mostrar stats (Disponible/Comprometido/Físico) y los ajustes manuales ± directamente en la tarjeta
6. **Preservar toda la funcionalidad existente:** ProductForm, PurchaseForm, CategoriesScreen siguen funcionando igual, solo cambian de ubicación en la navegación
7. **Redirect permanente `/catalogo-admin/*` → `/productos/*` y `/inventario` → `/productos`** en el router (`src/lib/router.ts`), con test mínimo (ver Diseño §Redirect). Relevante porque con el issue de SW stale en el backlog, un service worker viejo sirviendo links muertos es un vector de regresión plausible.
8. **Reescribir el special-case hardcodeado** `seg === "catalogo-admin"` en `src/app/AppShell.tsx:47-51` (TAB_FOR_PATH y mapeo de `seg`/`sub`) al nuevo segmento `productos` (ver Diseño §AppShell).

## Fuera de alcance (out)

1. No se cambia el modelo de datos `Product` ni `Purchase` — son correctos
2. No se modifica `ProductForm` ni `PurchaseForm` — ya editan los campos correctos
3. No se alteran las reglas de negocio de stock/cost/prices
4. No se implementa un nuevo formulario de productos
5. No se cambian los permisos ni aislamiento entre tiendas
6. No se toca la ruta pública `/catalogo/:slug` (catálogo público de clientas) — es un namespace distinto

## Diseño

### Estructura de navegación propuesta

**Antes (`src/design-system/navItems.ts:19-33`):**

```
- Inicio
- Catálogo (parent, path /catalogo-admin)
  - Productos (/catalogo-admin/productos)
  - Categorías (/catalogo-admin/categorias)
- Pedidos
- Clientes
- Inventario (solo inventory_tiered)
```

**Después:**

```
- Inicio
- Productos (parent, path /productos — renderiza la lista directamente)
  - Categorías (/productos/categorias)
  - Compras (/productos/compras — solo inventory_tiered)
- Pedidos
- Clientes
```

(Inventario desaparece del nav: la pestaña y `InventoryScreen` se retiran.)

**Decisiones cerradas:**

1. **El padre renderiza la lista — no existe `/productos/productos`.** Igual que hoy `/catalogo-admin` (sin sub) ya muestra la lista (`AppShell.tsx:47-48`: `sub === "categorias" ? ... : catalogo_productos`), `/productos` muestra la lista de productos. La doble ruta `/productos/productos` es ruido; se elimina del diseño.
2. **Sin pantalla wrapper nueva.** El patrón parent/children ya existe en el nav (`Sidebar.tsx:49-72` expande el grupo; `BottomNav.tsx:46-75` muestra los hijos bajo el padre activo). La navegación la resuelve el nav; `AppShell` mapea cada ruta a las pantallas existentes, como hace hoy. La única pieza nueva de UI es la vista de Compras extraída de `InventoryScreen` (lista + botón "+ Compra" + Sheet de `PurchaseForm`), que pasa a ser su propia pantalla en `/productos/compras`.
3. **El padre es navegable por su etiqueta y los hijos se expanden con un control separado.** Tocar la etiqueta "Productos" navega a `/productos` (la lista); el chevron/botón de expandir es un control aparte que muestra/oculta los hijos (Categorías, Compras). En móvil (`BottomNav`) los hijos del padre activo se muestran como hoy bajo el padre. Ninguna interfaz donde tocar el padre expanda en vez de navegar.
4. **Etiquetas:** padre "Productos", hijos "Categorías" y "Compras" — sin duplicados y sin hijo "Catálogo" (la lista es el default del padre; el título de pantalla "Catálogo" que ya muestra `CatalogScreen` se mantiene).
5. **Visibilidad de "Compras":** mismo criterio que tenía Inventario (`visibleNavItems` filtra por `storeType === "inventory_tiered"`); extender el filtro a los children del padre Productos. El botón "Ver público" de CatalogScreen sigue apuntando a `/catalogo/:slug`, que no cambia.

### Implementación UI

1. **Sin wrapper nuevo.** `AppShell` mapea `/productos` (con o sin sub) a las pantallas existentes: sin sub → `CatalogScreen`; `categorias` → `CategoriesScreen`; `compras` → nueva `PurchasesScreen` (movida, no reescrita, de `InventoryScreen`: su lista, botón "+ Compra" y Sheet de `PurchaseForm`).

2. **`InventoryScreen` se elimina** junto con su pestaña y la ruta `/inventario` (que pasa a redirigir). Lo que sobrevive de ella se integra a la lista de productos:
   - En stores `inventory_tiered`, cada tarjeta de producto (`CatalogScreen`) muestra las stats Disponible/Comprometido/Físico y los ajustes manuales ± (los controles de `InventoryScreen.tsx:70-133`, movidos a la tarjeta, no reescritos)
   - En stores `made_to_order` las tarjetas no cambian
   - El resto de `InventoryScreen` (botones "Compras"/"+ Compra", historial, Sheet de `PurchaseForm`) ya vive en `/productos/compras` y se borra con la pantalla

3. **navItems.ts actualizado** (`src/design-system/navItems.ts`):
   - Renombrar `catalogo` → `productos` en el union `Tab`; el padre `productos` mantiene su propio tab id (la lista renderiza bajo él)
   - Hijo `catalogo_categorias` → `productos_categorias`; agregar hijo `productos_compras` (solo visible en inventory_tiered — extender `visibleNavItems` para filtrar children, hoy solo filtra tabs)
   - **Eliminar el tab `inventario`** y su entrada del nav
   - Actualizar `parentActive()` a los prefijos nuevos
   - `Sidebar.tsx` y `BottomNav.tsx` referencian ids `catalogo_*` / `catalogoOpen` y deben actualizarse en paralelo (renombrar el estado local a `productosOpen`); el padre "Productos" navega por etiqueta y el chevron de expandir es un control separado (§Decisiones 3)

4. **Router actualizado** (`src/lib/router.ts`): el regex admin ya captura `tab`/`sub` genéricos; no requiere cambio para `/productos/*`. El cambio es el redirect (siguiente sección).

### Redirect `/catalogo-admin/*` → `/productos/*`

En `src/lib/router.ts`, al hacer match de la ruta admin, si `tab === "catalogo-admin"` se redirige (reemplazo en `history` + dispatch `popstate`, o `navigate()` — `pushState` simple) a `/productos` o `/productos/<sub>`: `/catalogo-admin` → `/productos`, `/catalogo-admin/productos` → `/productos` (la lista es el default del padre), `/catalogo-admin/categorias` → `/productos/categorias`. Además `/inventario` → `/productos` (Inventario ya no existe como pantalla). El admin regex solo acepta un `sub`, así que no hay paths más profundos que cubrir.

**Test mínimo (vitest):** para cada una de las cuatro URLs viejas, `matchRoute` (o la función de redirect) resuelve a la nueva URL y `AppShell`/`TAB_FOR_PATH` mapean el resultado a un tab de `productos`, no a `inicio`.

### AppShell: reescritura del special-case

`src/app/AppShell.tsx:47-51` hoy hardcodea `seg === "catalogo-admin"`. Se reescribe al nuevo segmento: `TAB_FOR_PATH` cambia `"catalogo-admin": "catalogo"` → `"productos": "productos"` y el branch especial pasa a `seg === "productos"` con `tab = sub === "categorias" ? "productos_categorias" : sub === "compras" ? "productos_compras" : "productos"`. El `switch` de screens (líneas 79-97) mapea: `productos` → `CatalogScreen`, `productos_categorias` → `CategoriesScreen`, `productos_compras` → `PurchasesScreen`; el case de `inventario` se elimina.

### Referencias concretas al código existente

- **ProductForm ya edita todo**: `src/features/catalog/ProductForm.tsx:418-446` tiene los campos de costo, precios y cantidad
- **PurchaseForm edita precios inline**: `src/features/inventory/PurchaseForm.tsx:188-215` muestra que el flujo de compra ya puede ajustar precios
- **Categorías funcionan bien**: `src/features/catalog/CategoriesScreen.tsx` está completo y no necesita cambios
- **Stats y ajustes ± reutilizables**: `src/features/inventory/InventoryScreen.tsx:70-133` (Disponible/Comprometido/Físico y controles ±) se mueven a la tarjeta de producto tiered; la lista/historial de compras (`:44-67`, `:135-137`) se mueve a `/productos/compras`
- **Referencias a `catalogo-admin`/`catalogo_`/`inventario` a actualizar**: `src/app/AppShell.tsx`, `src/lib/router.ts` (redirects), `src/design-system/navItems.ts`, `src/design-system/Sidebar.tsx`, `src/design-system/BottomNav.tsx`

### Ponytail

- Reutilizamos `CatalogScreen` casi intacto (solo cambiamos su contenedor y las tarjetas tiered ganan stats ±)
- Reutilizamos `CategoriesScreen`, `PurchaseList` y `PurchaseForm` sin cambios
- No creamos nuevos componentes de UI más allá de la pantalla de Compras extraída; los ajustes de inventario se mueven a las tarjetas en vez de sobrevivir en una pantalla propia

## Criterios de aceptación

1. ✅ La pestaña "Catálogo" desaparece del nav (móvil y desktop)
2. ✅ La pestaña "Inventario" desaparece del nav (móvil y desktop); no existe `InventoryScreen` en el código
3. ✅ Nueva pestaña "Productos" (padre) que renderiza la lista directamente, con hijos Categorías y (Compras si inventory_tiered) — sin pantalla wrapper nueva ni etiqueta duplicada
4. ✅ El padre "Productos" navega a `/productos` al tocar su etiqueta; el control de expandir hijos es un control separado (chevron)
5. ✅ En stores inventory_tiered, las tarjetas de producto muestran stats (Disponible/Comprometido/Físico) y ajustes ±; en made_to_order no cambian
6. ✅ Categorías funciona igual que antes, solo accesible desde Productos
7. ✅ Compras funciona igual que antes, solo accesible desde Productos
8. ✅ URL routing funciona: `/productos` → lista (CatalogScreen), `/productos/categorias` → Categorías, `/productos/compras` → Compras. No existe `/productos/productos` ni `/inventario`
9. ✅ Redirects: `/catalogo-admin`, `/catalogo-admin/productos` → `/productos`; `/catalogo-admin/categorias` → `/productos/categorias`; `/inventario` → `/productos` (cubiertos por test vitest)
10. ✅ No hay cambios en el modelo de datos ni en los forms existentes
11. ✅ La edición de stock/cost/prices desde ProductForm sigue funcionando
12. ✅ La creación de compras con edición de precios inline sigue funcionando
13. ✅ La ruta pública `/catalogo/:slug` no cambia (botón "Ver público" intacto)

## previewChecks

```json
[
  { "path": "/", "selector": "body", "text": "Entrar" }
]
```

(Humo de arranque; la navegación padre/hijos, redirects y tarjetas tiered quedan cubiertos por el test vitest del redirect y por e2e.)

## Riesgos

1. **Bajo:** Reorganización de UI es intrusiva visualmente; el usuario puede tardar en adaptarse al nuevo lugar de Categorías/Compras y a los ajustes ± en la tarjeta.
2. **Bajo:** URLs cambian (`/catalogo-admin/*`, `/inventario` → `/productos/*`); bookmarks externos se rompen (probabilidad baja: admin es privado).
3. **Mitigado:** Si un usuario tenía abierto `/catalogo-admin/productos` o `/inventario` en una tab (o un service worker stale sirve links viejos), el redirect del router lo lleva a `/productos/*` — cubierto por test y previewCheck.

## Dependencias

- Ninguna: esta entrega es puramente de reorganización de navegación/UI sin cambios de backend ni modelo de datos.

## Nota de implementación previa

El PR #27 (cerrado sin merge, 2026-08-18) implementó una versión anterior de esta spec
que **conservaba** Inventario simplificado. Tras aprobar esta versión, sus commits
pueden rescatarse como base, pero exigen rework: retirar `InventoryScreen`/tab/ruta,
integrar stats ± a las tarjetas tiered y agregar el redirect de `/inventario`.
