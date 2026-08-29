---
Delivery-ID: productos-sort-filter
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/productos-sort-filter-design.md
---
# /productos: ordenar y filtrar por categoría

## Problema

La pantalla `/productos` (`src/features/catalog/CatalogScreen.tsx`) muestra el
grid de productos de la tienda activa **sin ningún orden ni filtro**: los datos
salen de `productsForStore(state.products, activeStore.id)`
(`src/lib/selectors.ts:6-8`, que solo filtra por storeId) en el orden crudo del
array. Con el catálogo creciendo (23+ piezas en Olivia) encontrar una pieza
concreta exige scroll manual.

**Petición del owner (2026-08-28):** poder ordenar y filtrar; el filtrado se
limita a categoría.

## Objetivo

1. Filtrar la lista por categoría **real** (colección `categories` vía
   `categoryIds`), no por el enum legacy `category` que pintan los badges.
2. Ordenar por **Nombre / Precio / Stock / Fecha** con toggle de dirección.
3. Mobile-first, solo design system, sin dependencias nuevas.

## Alcance (in)

### 1. Controles (`CatalogScreen.tsx`, sobre el grid `:231`)

- **Filtro de categoría:** `SelectField` ("Categoría": Todas + opciones de
  `activeCategoriesForStore(state.categories, activeStore.id)`
  — `src/lib/selectors.ts:23-27`, ya activas y ordenadas por `sortOrder`).
  Match contra `product.categoryIds` (primaria **o** secundarias).
- **Orden:** `SelectField` ("Ordenar por": Nombre / Precio / Stock / Fecha)
  + toggle de dirección (asc/desc), estado `useState` local (patrón del repo;
  sin estado de URL).

### 2. Semántica de cada orden

| Campo | Clave | Notas |
|---|---|---|
| Nombre | `name` | `localeCompare('es')` |
| Precio | precio público efectivo (`publicPrice`, `src/lib/money.ts`) | tiered: tier default; on_demand: `price` |
| Stock | `quantityOnHand` | solo tiendas con inventario; en `on_demand` la opción se oculta/deshabilita |
| Fecha | `createdAt` | recientes primero por defecto |
| Dirección | toggle asc/desc | por defecto: Fecha desc (recientes), Nombre asc, Precio asc, Stock asc |

Orden estable: empates se resuelven por `name`.

### 3. Contador

El subtítulo de `ScreenHeader` refleja lo filtrado: "N de M piezas" (N =
post-filtro+orden, M = total de la tienda). Con filtro aplicado, botón/enlace
"Limpiar" para volver a "Todas".

## Alcance (out)

- Búsqueda por texto (no pedida; otra entrega).
- Estado de filtros en URL.
- Cambiar los badges del enum legacy `category` (pueden desalinearse con el
  filtro de categorías reales; se documenta, no se toca).
- Orden por `updatedAt` o `sortOrder` manual.

## Criterios de aceptación

1. Filtrar por una categoría oculta las piezas que no pertenecen; el contador
   refleja "N de M"; "Limpiar" restaura "Todas".
2. Cada orden produce el orden esperado en ambas direcciones (con fixtures:
   nombres en mayúsculas/minúsculas mezcladas, precios iguales para probar el
   desempate, stocks negativos/cero, fechas ISO).
3. En tienda `on_demand` la opción Stock no aparece; el resto funciona.
4. Tests UI en vitest con el patrón de `src/app/App.test.tsx`
   (`withState` + `fixtureState()` + testing-library), escritos ANTES por el
   agente de TESTS y en rojo antes de la implementación (misma separación
   anti-bias que public-product-detail: TESTS no lee la implementación,
   CÓDIGO no lee los tests).
5. `npm run typecheck && npm run test && npm run build` verdes; el gate de
   design-system (`design-system-gate.test.ts`) pasa (nada de `<select>` crudo
   en features).
6. UI 100% español; mobile-first (controles colapsan a una fila con scroll
   horizontal si no caben); cero dependencias nuevas.

## previewChecks

```json
[
  { "path": "/", "selector": "body", "text": "Entrar" }
]
```

(Humo de arranque; `/productos` requiere sesión. El comportamiento queda
cubierto por tests UI y por un e2e en emulador si el diff lo amerita.)

## Notas de implementación

- `SelectField` (`src/design-system/FormField.tsx:86-119`) para ambos
  controles; el toggle de dirección es `IconButton` con aria-label español
  ("Orden ascendente"/"Descendente") o segundo `SelectField` — decidir por
  diseño móvil, sin primitivos nuevos.
- El filtro NO cambia `productsForStore` (selector compartido): transformar el
  array ya filtrado por tienda, dentro del componente.
- Costo cero: nada toca Firestore; todo es render local.
