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
5. **Mantener Inventario solo para stores inventory_tiered** pero simplificado a solo la vista de ajustes +/- y stats (Disponible/Comprometido/Físico)
6. **Preservar toda la funcionalidad existente:** ProductForm, PurchaseForm, CategoriesScreen siguen funcionando igual, solo cambian de ubicación en la navegación
7. **Redirect permanente `/catalogo-admin/*` → `/productos/*`** en el router (`src/lib/router.ts`), con test mínimo (ver Diseño §Redirect). Relevante porque con el issue de SW stale en el backlog, un service worker viejo sirviendo links muertos es un vector de regresión plausible.
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
- Inventario (solo inventory_tiered, reducido a ajustes manuales +/-)
```

**Decisiones cerradas:**

1. **El padre renderiza la lista — no existe `/productos/productos`.** Igual que hoy `/catalogo-admin` (sin sub) ya muestra la lista (`AppShell.tsx:47-48`: `sub === "categorias" ? ... : catalogo_productos`), `/productos` muestra la lista de productos. La doble ruta `/productos/productos` es ruido; se elimina del diseño.
2. **No se crea `ProductosScreen`.** El patrón parent/children ya existe en el nav (`Sidebar.tsx:49-72` expande el grupo; `BottomNav.tsx:46-75` muestra los hijos bajo el padre activo). La navegación la resuelve el nav; `AppShell` mapea cada ruta a las pantallas existentes, como hace hoy. La única pieza nueva de UI es la vista de Compras extraída de `InventoryScreen` (lista + botón "+ Compra" + Sheet de `PurchaseForm`), que pasa a ser su propia pantalla en `/productos/compras`.
3. **Etiquetado:** padre "Productos", hijos "Categorías" y "Compras" — sin duplicados y sin hijo "Catálogo" (la lista es el default del padre; el título de pantalla "Catálogo" que ya muestra `CatalogScreen` se mantiene).
4. **Visibilidad de "Compras":** mismo criterio que Inventario hoy (`visibleNavItems` filtra por `storeType === "inventory_tiered"`); extender el filtro a los children del padre Productos. El botón "Ver público" de CatalogScreen sigue apuntando a `/catalogo/:slug`, que no cambia.

### Implementación UI

1. **Sin wrapper nuevo.** `AppShell` mapea `/productos` (con o sin sub) a las pantallas existentes: sin sub → `CatalogScreen`; `categorias` → `CategoriesScreen`; `compras` → nueva `PurchasesScreen` (movida, no reescrita, de `InventoryScreen`: su lista, botón "+ Compra" y Sheet de `PurchaseForm`).

2. **InventarioScreen simplificado**:
   - Remueve los botones "Compras" y "+ Compra" y la vista de historial (`src/features/inventory/InventoryScreen.tsx:58-67`, `showHistory` líneas 44-51, y el Sheet de `PurchaseForm` líneas 135-137)
   - Solo conserva los ajustes +/- y stats (líneas 70-133)

3. **navItems.ts actualizado** (`src/design-system/navItems.ts`):
   - Renombrar `catalogo` → `productos` en el union `Tab`; el padre `productos` mantiene su propio tab id (la lista renderiza bajo él)
   - Hijo `catalogo_categorias` → `productos_categorias`; agregar hijo `productos_compras` (solo visible en inventory_tiered — extender `visibleNavItems` para filtrar children, hoy solo filtra tabs)
   - Actualizar `parentActive()` a los prefijos nuevos
   - `Sidebar.tsx` y `BottomNav.tsx` referencian ids `catalogo_*` / `catalogoOpen` y deben actualizarse en paralelo (renombrar el estado local a `productosOpen`)

4. **Router actualizado** (`src/lib/router.ts`): el regex admin ya captura `tab`/`sub` genéricos; no requiere cambio para `/productos/*`. El cambio es el redirect (siguiente sección).

### Redirect `/catalogo-admin/*` → `/productos/*`

En `src/lib/router.ts`, al hacer match de la ruta admin, si `tab === "catalogo-admin"` se redirige (reemplazo en `history` + dispatch `popstate`, o `navigate()` — `pushState` simple) a `/productos` o `/productos/<sub>`: `/catalogo-admin` → `/productos`, `/catalogo-admin/productos` → `/productos` (la lista es el default del padre), `/catalogo-admin/categorias` → `/productos/categorias`. El admin regex solo acepta un `sub`, así que no hay paths más profundos que cubrir.

**Test mínimo (vitest):** para cada una de las tres URLs viejas, `matchRoute` (o la función de redirect) resuelve a la nueva URL y `AppShell`/`TAB_FOR_PATH` mapean el resultado a un tab de `productos`, no a `inicio`.

### AppShell: reescritura del special-case

`src/app/AppShell.tsx:47-51` hoy hardcodea `seg === "catalogo-admin"`. Se reescribe al nuevo segmento: `TAB_FOR_PATH` cambia `"catalogo-admin": "catalogo"` → `"productos": "productos"` y el branch especial pasa a `seg === "productos"` con `tab = sub === "categorias" ? "productos_categorias" : sub === "compras" ? "productos_compras" : "productos"`. El `switch` de screens (líneas 79-97) mapea: `productos` → `CatalogScreen`, `productos_categorias` → `CategoriesScreen`, `productos_compras` → `PurchasesScreen`.

### Referencias concretas al código existente

- **ProductForm ya edita todo**: `src/features/catalog/ProductForm.tsx:418-446` tiene los campos de costo, precios y cantidad
- **PurchaseForm edita precios inline**: `src/features/inventory/PurchaseForm.tsx:188-215` muestra que el flujo de compra ya puede ajustar precios
- **Categorías funcionan bien**: `src/features/catalog/CategoriesScreen.tsx` está completo y no necesita cambios
- **InventarioScreen mix**: `src/features/inventory/InventoryScreen.tsx:58-67` son los botones que se moverán a Productos
- **Referencias a `catalogo-admin`/`catalogo_` a actualizar**: `src/app/AppShell.tsx`, `src/lib/router.ts` (redirect), `src/design-system/navItems.ts`, `src/design-system/Sidebar.tsx`

### Ponytail

- Reutilizamos `CatalogScreen` casi intacto (solo cambiamos su contenedor)
- Reutilizamos `CategoriesScreen`, `PurchaseList` y `PurchaseForm` sin cambios
- No creamos nuevos componentes de UI, solo reorganizamos los existentes (la única pieza nueva es el wrapper ProductosScreen y el redirect de una línea en el router)
- La separación entre "ver productos" vs "ajustar inventario" se mantiene vía el tab Inventario (solo ajustes +/-)

## Criterios de aceptación

1. ✅ La pestaña "Catálogo" desaparece del nav (móvil y desktop)
2. ✅ Nueva pestaña "Productos" (padre) que renderiza la lista directamente, con hijos Categorías y (Compras si inventory_tiered) — sin pantalla wrapper nueva ni etiqueta duplicada
3. ✅ La lista de productos se ve idéntica a antes (mismo `ProductCard`, mismo `ProductForm` al editar)
4. ✅ Categorías funciona igual que antes, solo accesible desde Productos
5. ✅ Compras funciona igual que antes, solo accesible desde Productos
6. ✅ Inventario (solo inventory_tiered) muestra solo los ajustes +/- y stats, sin botones de compras
7. ✅ URL routing funciona: `/productos` → lista (CatalogScreen), `/productos/categorias` → Categorías, `/productos/compras` → Compras. No existe `/productos/productos`
8. ✅ Redirect: `/catalogo-admin` y `/catalogo-admin/categorias` → equivalentes bajo `/productos/*`; `/catalogo-admin/productos` → `/productos` (cubierto por test vitest)
9. ✅ No hay cambios en el modelo de datos ni en los forms existentes
10. ✅ La edición de stock/cost/prices desde ProductForm sigue funcionando
11. ✅ La creación de compras con edición de precios inline sigue funcionando
12. ✅ La ruta pública `/catalogo/:slug` no cambia (botón "Ver público" intacto)

## previewChecks

```json
{
  "smoke": [
    {
      "name": "NavProductosVisible",
      "viewport": "mobile",
      "path": "/productos",
      "selector": "nav a[href='/productos']",
      "text": "Productos",
      "expect": "Nav muestra 'Productos' y NO muestra 'Catálogo' como pestaña padre"
    },
    {
      "name": "CatalogoDentroDeProductos",
      "viewport": "mobile",
      "path": "/productos",
      "selector": "main h1, main h2, main h3",
      "text": "Catálogo",
      "expect": "Lista de productos idéntica a la actual CatalogScreen (título 'Catálogo')"
    },
    {
      "name": "CategoriasDentroDeProductos",
      "viewport": "mobile",
      "path": "/productos/categorias",
      "selector": "main",
      "text": "Categorías",
      "expect": "Pantalla de categorías funcionando igual que antes"
    },
    {
      "name": "ComprasDentroDeProductos",
      "viewport": "mobile",
      "path": "/productos/compras",
      "selector": "main button",
      "text": "+ Compra",
      "expect": "En store inventory_tiered, pantalla de compras con botón '+ Compra'"
    },
    {
      "name": "RedirectCatalogoAdmin",
      "viewport": "mobile",
      "path": "/catalogo-admin/productos",
      "selector": "main",
      "text": "Catálogo",
      "expect": "La URL vieja termina en /productos y renderiza la lista de productos"
    },
    {
      "name": "InventarioSimplificado",
      "viewport": "mobile",
      "path": "/inventario",
      "selector": "main button",
      "expect": "Solo ajustes +/- y stats; SIN botones 'Compras' ni '+ Compra'"
    },
    {
      "name": "ProductFormEditaStock",
      "viewport": "mobile",
      "path": "/productos",
      "selector": "main form label",
      "text": "En existencia",
      "expect": "Al editar un producto en store inventory_tiered, el formulario muestra cost, precios y cantidad como ahora"
    }
  ],
  "regression": [
    {
      "name": "CatalogoNoExiste",
      "viewport": "mobile",
      "path": "/",
      "selector": "nav",
      "expect": "Nav NO tiene pestaña padre 'Catálogo'"
    },
    {
      "name": "InventarioNoTieneCompras",
      "viewport": "mobile",
      "path": "/inventario",
      "selector": "main button",
      "expect": "NO hay botones 'Compras' ni '+ Compra' en Inventario"
    },
    {
      "name": "CatalogoPublicoIntacto",
      "viewport": "mobile",
      "path": "/catalogo/olivia-joyeria",
      "selector": "main",
      "expect": "La ruta pública de catálogo sigue funcionando sin cambios"
    }
  ]
}
```

## Riesgos

1. **Bajo:** Reorganización de UI es intrusiva visualmente; el usuario puede tardar en adaptarse al nuevo lugar de Categorías/Compras.
2. **Bajo:** URLs cambian (`/catalogo-admin/*` → `/productos/*`); bookmarks externos se rompen (probabilidad baja: admin es privado).
3. **Mitigado:** Si un usuario tenía abierto `/catalogo-admin/productos` en una tab (o un service worker stale sirve links viejos), el redirect del router lo lleva a `/productos/*` — cubierto por test y previewCheck.

## Dependencias

- Ninguna: esta entrega es puramente de reorganización de navegación/UI sin cambios de backend ni modelo de datos.
