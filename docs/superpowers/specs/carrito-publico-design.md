---
Delivery-ID: carrito-publico
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/carrito-publico-design.md
---
# Carrito público: acumular piezas y pedir varias por WhatsApp

## Problema

El storefront público de Olivia solo permite preguntar por **una pieza a la
vez** (`createStorefrontBuyUrl`, `src/lib/whatsapp.ts:66-78`): cada compra es
un mensaje suelto con una pieza. Una clienta que quiere varias piezas debe
abrir un chat por pieza. Además, los precios por tier (Regular / Girly /
Iconic) son invisibles para el público: la proyección expone **un solo
precio** resuelto al tier default, por diseño
(`firestoreData.ts:467-468`, invariante testeado en `firestoreData.test.ts:86`).

**Decisión del owner (sesión brainstorm 2026-08-29, diseño aprobado):**

1. Carrito **solo en Olivia** (`OliviaStorefront`); `PublicCatalogScreen` no
   cambia (ni siquiera enlaza productos hoy).
2. Los 3 precios por tier **se hacen públicos** (con sus mínimos). Se
   actualiza el invariante de proyección — decisión de negocio explícita.
3. Tiers **solo informativos** en el carrito: sin selección ni totales
   comprometidos en v1; el precio final se cierra en el chat.
4. Con **cantidades** por pieza (stepper ±).
5. Leyenda de stock con **señal gruesa**: la proyección expone
   `"agotado" | "pocas" | "disponible"` (derivada de `quantityOnHand` y
   `lowStockAt`), **nunca la cifra exacta**.
6. Los tiers ganan **mínimos de calificación**: Regular sin mínimo, Girly
   desde 5 piezas, Iconic desde $1,000 de compra (datos, editables,
   **nunca forzados en cliente** — informativos; el owner confirma en chat).
7. Persistencia en `localStorage` por tienda; sin backend, sin cuentas,
   sin sync cross-device (WhatsApp ya vive en un dispositivo).

## Objetivo

1. Una visitante anónima acumula piezas con cantidades en un carrito que
   sobrevive recargas, revisa su pedido y lo envía en **un solo mensaje de
   WhatsApp** con todas las líneas.
2. El catálogo muestra los 3 precios con su nombre y mínimo de calificación.
3. La leyenda de inventario invita a ordenar aunque supere lo disponible
   ("podemos reabastecer") sin exponer cifras exactas.

## Alcance (in)

### 1. Modelo: mínimos de tier (`src/types/index.ts:105-110`)

```ts
export type PriceTierDef = {
  id: string; label: string; order: number; hidden?: boolean;
  minPieces?: number;   // califica por número de piezas (Girly: 5)
  minAmount?: number;   // califica por monto de compra (Iconic: 1000)
};
```

- Editor en `StoreSettingsScreen` (Niveles de precio, `:374-443`): dos campos
  numéricos opcionales por tier; vacío = sin mínimo.
- Los labels comerciales ("Regular", "Girly", "Iconic") ya son editables hoy;
  no se tocan.

### 2. Proyección pública ampliada (`firestoreData.ts` + `publicCatalog.ts`)

- `projectPublicStore` (`:453-464`): += `priceTiers` (visibles, con
  `minPieces/minAmount`) y `defaultTierId`. Tipo `PublicStore` (`:45-51`) se
  extiende igual.
- `projectPublicProductSummary` / `projectPublicProductDetail`:
  += `prices: Record<string, number>` (solo tiers visibles) y
  `stockSignal: "agotado" | "pocas" | "disponible"` (`0` / `<= lowStockAt` /
  resto). El `price` único se conserva (compatibilidad y orden grid).
- Actualizar el invariante y sus tests (`firestoreData.test.ts:86`, `:239`):
  el tier map es público **por decisión del owner**; `cost` sigue privado.
- Reglas: sin cambios (los 3 docs públicos ya son de lectura anónima y la
  escritura es owner/member). Republicar tras deploy para refrescar docs
  existentes ("Republicar catálogo").

### 3. Storefront (`OliviaStorefront.tsx`)

- **Detalle:** tabla de precios por tier — nombre, precio y mínimo
  ("Girly · desde 5 piezas" / "Iconic · desde $1,000"); el default resaltado.
  Fallback: proyección estancada sin tiers → solo el precio único actual.
- **Botón "Agregar al carrito"** en detalle y en cada card del grid (agrega
  la cantidad 1 o incrementa si ya está).
- **Botón flotante** con contador de piezas → abre el carrito.

### 4. Carrito (nuevo `CartDrawer` sobre el `Sheet` del design system)

- Líneas: miniatura, nombre, stepper ± (mín 1, quitar), señal de stock por
  línea. Copys de la leyenda (tono que invita a ordenar, textos exactos en
  implementación):
  - `"pocas"` → *"Quedan pocas — tu pedido puede reabastecerse y entregarse
    completo 💛"*
  - `"agotado"` → *"Se puede hacer sobre pedido — te confirmamos fecha de
    reabastecimiento 💛"*
- **Revisión (pre-checkout):** resumen de líneas + hint informativo de tier
  por piezas (*"llevas 6 piezas · aplica precio Girly"*) — solo para mínimos
  por piezas; los mínimos por monto (Iconic) se muestran como condición en
  la tabla de precios pero no generan hint en v1 (no hay totales).
- **Checkout = WhatsApp:** botón "Enviar pedido por WhatsApp" → nuevo builder
  `buildCartOrderUrl(store, lines)` en `src/lib/whatsapp.ts`: intro editable
  como prefijo (convención `:41-44`), cuerpo `Pedido:` + líneas
  `• 2× Anillo Blossom (AAN1385)` + link al catálogo. Sin precios en v1.
- Pieza agotada usa el intent "preguntar" existente.

### 5. Estado (`useCart` hook + `src/lib/cart.ts`)

- `localStorage` con clave por tienda (`store-os:cart:{slug}`), versión de
  esquema, tolerante a JSON corrupto (descarta y empieza limpio).
- Opera sobre datos **públicos** (summary: id, slug, nombre, sku); si una
  pieza ya no está en la proyección, la línea se descarta en silencio al
  renderizar.

## Alcance (out)

- Totales, selección de tier por línea, forzado de mínimos en cliente (v1;
  el precio lo confirma el owner en el chat).
- Backend de carritos, sync cross-device, cuentas de visitante.
- `PublicCatalogScreen` (tiendas no-Olivia) y mintear slugs ahí.
- Métricas de carritos abandonados.

## Criterios de aceptación

1. Agregar 3 piezas distintas → contador 3 → drawer muestra 3 líneas →
   "Enviar pedido" abre `wa.me` con las 3 líneas y el link; sobrevive
   recarga (localStorage).
2. Stepper ± actualiza líneas y contador; quitar elimina la línea.
3. Detalle muestra los 3 precios con mínimos; con proyección estancada cae
   al precio único sin romper.
4. Leyenda "pocas"/"agotada" aparece según `stockSignal`, nunca cifras.
5. Tests UI primero (patrón `App.test.tsx` / `primitives.test.tsx`), en rojo
   antes de la implementación: agente TESTS no lee la implementación, agente
   CÓDIGO no lee los tests (misma separación anti-bias que
   `public-product-detail`).
6. Unit para: builder del mensaje (intro-prefijo + líneas + URL), señal de
   stock, persistencia/corrupción de carrito. e2e: flujo agregar → revisar
   → `wa.me`.
7. `npm run typecheck && npm run test && npm run build` verdes; gate de
   design-system pasa (Sheet/TextField, nada crudo).
8. UI 100% español, mobile-first, sin dependencias nuevas.

## previewChecks

```json
[
  { "path": "/catalogo/olivia", "selector": "body", "text": "Olivia" }
]
```

(El flujo completo de carrito queda cubierto por tests UI + e2e en emulador.)

## Notas de implementación

- Un solo delivery: proyección + storefront + carrito (es una feature
  coherente; P1 demostró el ritmo de ~4 commits).
- TESTS primero (rojo registrado), luego CÓDIGO (proyección → UI → builder),
  cruza verde, `verify quick/final`, PR draft con `Delivery-ID`.
- Tocar `firestoreData.test.ts` exige actualizar los invariantes de proyección
  — es parte del cambio, no una flexibilización accidental.
- Tras merge: **Republicar catálogo** en el backend correspondiente para
  refrescar `publicStores`/`publicProducts` existentes.
