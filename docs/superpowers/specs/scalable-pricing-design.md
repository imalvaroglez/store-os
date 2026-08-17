---
Delivery-ID: scalable-pricing
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/scalable-pricing-design.md
---
# Precios escalables (nombres mutables + extensibles) y precio sugerido

## Problema / Causa raíz (verificada en código)

Olivia maneja varios precios por producto (menudeo, mayoreo, emprendedora), pero hoy son un enum fijo de 3 valores tildado en el código:

- `ProductPrices = { retail?, wholesale?, reseller? }` (`src/types/index.ts:98-102`) y `PriceTier = "retail" | "wholesale" | "reseller"` (`src/types/index.ts:189`).
- `Product.prices?: ProductPrices` (`src/types/index.ts:158`) y `Order.priceTier?: PriceTier` (`src/types/index.ts:204`).
- Los labels en español también son fijos: `TIER_LABELS` (`src/lib/labels.ts:25-29`) — "Menudeo / Mayoreo / Emprendedora".
- Los tres tiers están cableados en: `ProductForm.tsx` (estado `retail/wholesale/reseller` en `src/features/catalog/ProductForm.tsx:64,263,429`), `PurchaseForm.tsx` (`src/features/inventory/PurchaseForm.tsx:201-209` y `339-385`), `OrderForm.tsx` (`TIER_OPTIONS` en `src/features/orders/OrderForm.tsx:17-19`, `selectTier` en `:55-60`, `SelectField` "Nivel de precio" en `:152-158`), `CatalogScreen.tsx:119` e `InventoryScreen.tsx:89` (muestran `prices.retail` con el texto "Menudeo" fijo).
- El catálogo público toma el precio con `publicPrice()` (`src/lib/money.ts:13-18`), que devuelve `prices.retail`; las proyecciones públicas también exponen solo `retail` (`src/app/firebase/firestoreData.ts:377,423`).

Fer necesita (a) renombrar los niveles, (b) agregar niveles nuevos sin migrar esquema, (c) un asistente que sugiera el precio público a partir del costo.

## Decisiones de diseño (las 4 abiertas del backlog, propuesta para firma del PO)

1. **Tiers por tienda, no globales.** `Store.priceTiers` define cuántos precios hay y cómo se llaman. Fer controla sus etiquetas sin afectar a otras tiendas.
2. **Orden explícito.** Cada tier lleva `order`; los forms y el catálogo iteran `priceTiers` ordenado. Además `Store.defaultTierId` decide cuál es el precio "al público".
3. **Precio sugerido = markup % simple sobre el costo.** `Store.pricingRule = { kind: "markup", percent }` (p. ej. 120% sobre costo). Margen objetivo y tablas por rango quedan out-of-scope (YAGNI). Es asistente: Fer siempre puede sobreescribir el valor.
4. **Migración canónica con ids estables.** Los 3 tiers existentes se migran a ids `t_retail`, `t_wholesale`, `t_reseller` con labels actuales; los datos de precio se re-mapean por id, sin pérdida.

## Objetivo

Reemplazar el enum fijo por un modelo extensible por tienda, con migración idempotente que preserve los 3 precios existentes, y un precio sugerido configurable desde el costo.

## Alcance (in)

### 1. Modelo de datos

```ts
// src/types/index.ts
export type PriceTierDef = {
  id: string;      // estable, p.ej. "t_retail". Nunca cambia tras crearse.
  label: string;   // cosmético, editable. p.ej. "Menudeo".
  order: number;   // orden de despliegue.
};

// Store (plano de datos `stores`; NO va a adminStores — es contenido de negocio)
priceTiers?: PriceTierDef[];        // ausente = aún no migrada la tienda
defaultTierId?: string;             // ausente = primer tier por order
pricingRule?: { kind: "markup"; percent: number };

// Product: prices pasa de ProductPrices (enum duro) a mapa abierto
prices?: Record<string, number>;    // clave = tier id

// Order: priceTier pasa de PriceTier a string (tier id snapshot)
priceTier?: string;
```

- `PriceTier` y `ProductPrices` se eliminan; `TIER_LABELS` se elimina.
- Helpers nuevos en `src/lib/pricing.ts`:
  - `tiersForStore(store): PriceTierDef[]` — ordenados; fallback a los 3 canónicos si la tienda aún no migra (defensivo, no debería ocurrir post-migración).
  - `defaultTier(store): PriceTierDef | undefined`.
  - `suggestedPrice(cost, rule): number | undefined` — `cost * (1 + percent/100)`, redondeado a entero (MXN).
- `publicPrice(p)` (`src/lib/money.ts:13-18`) pasa a aceptar el tier: `publicPrice(p, defaultTierId)` → `p.prices?.[defaultTierId]`. El catálogo público siempre muestra el tier por defecto de la tienda.

### 2. Migración idempotente

Extiende la migración existente en `src/lib/catalog.ts` (`migrateCatalog`, `:160-245`, ya corre en `StoreProvider.tsx:188,207` y `storage.ts:31`):

- Sube `CURRENT_PRODUCT_SCHEMA_VERSION` (`src/lib/catalog.ts`).
- Por tienda sin `priceTiers`: crea `priceTiers = [{id:"t_retail",label:"Menudeo",order:0},{id:"t_wholesale",label:"Mayoreo",order:1},{id:"t_reseller",label:"Emprendedora",order:2}]`, `defaultTierId = "t_retail"`. Sin `pricingRule` (asistente opt-in).
- Por producto con `schemaVersion` viejo: `prices = { t_retail: old.retail, t_wholesale: old.wholesale, t_reseller: old.reseller }` (claves undefined fuera). Órdenes existentes: `priceTier: "retail"` → `"t_retail"` (mapeo de los 3 valores).
- Re-corrida = no-op (schemaVersion + priceTiers presentes).
- **Cloud:** la migración corre en cliente al cargar estado (`StoreProvider`), igual que hoy; no se requiere script de servidor. El guardado de tiers editados escribe `stores/{id}.priceTiers` (1 write por edición de ajustes, dentro de cuota).

### 3. UI — edición de tiers (StoreSettingsScreen)

En `StoreSettingsScreen.tsx`, sección "Niveles de precio" (solo tiendas `inventory_tiered`):

- Lista de tiers: label editable (TextField), subir/bajar (order), eliminar (confirmación; los productos simplemente quedan sin ese precio).
- "Agregar nivel": nuevo id generado (`t_` + slug del label + sufijo numérico si colisiona), label editable.
- Marcar cuál es el precio al público (`defaultTierId`, radio/Select).
- Regla de precio sugerido: un campo "Ganancia sobre costo (%)" que guarda `pricingRule` (vacío = sin asistente).

### 4. UI — forms y listas

- `ProductForm.tsx`: los 3 TextFields fijos (`:429` y hermanos) pasan a iterar `tiersForStore(activeStore)`. Junto al campo del tier por defecto, si `cost` y `pricingRule` existen: texto de ayuda "Sugerido: $X" y botón/chip "Usar" que llena el campo.
- `PurchaseForm.tsx`: el mapa sobre `["retail","wholesale","reseller"]` (`:201-209`) y los estados fijos (`:339-385`) iteran los tiers de la tienda con sus labels.
- `OrderForm.tsx`: `TIER_OPTIONS` se construye desde `tiersForStore(activeStore)`; `selectTier`/`selectProduct` usan tier ids string.
- `CatalogScreen.tsx:119` e `InventoryScreen.tsx:89`: label y valor desde el tier por defecto de la tienda (texto "Menudeo" fijo → `defaultTier(store).label`).

### 5. Proyecciones públicas y reglas

- `src/app/firebase/firestoreData.ts:377,423`: `summary.prices`/`detail.prices` exponen solo `{ [defaultTierId]: valor }` — allow-list sigue siendo "solo el precio al público", nunca mayoreo ni costos (G-P05).
- `firestore.rules` sin cambios: `priceTiers` vive en `stores` (plano de datos, ya cubierto por reglas de membresía); **no** se agrega a `adminStores` ni a su allow-list (`src/app/firebase/rules-allowlist.ts`) — es contenido de negocio, no control (G-P02).

## Alcance (out)

- Descuentos por volumen / pricing dinámico.
- Histórico de precios por producto.
- Regla de margen objetivo o tabla por rango de costo.
- Tier por defecto por clienta.

## Costo (free tier)

- Migración: 0 writes extra — corre en cliente antes del primer save; los productos ya migrados se guardan con su siguiente edición normal.
- Editar tiers: 1 write de `stores/{id}` por guardado en ajustes.
- Guardar producto/orden: mismo número de writes que hoy (el mapa `prices` es el mismo campo).
- Sin dependencias nuevas, sin Functions, sin Storage extra.

## Pruebas

- Unit (`vitest`): `suggestedPrice` (markup, redondeo, sin costo → undefined); `tiersForStore` (orden, fallback canónico); migración idempotente (legacy prices → t_* y re-run no-op; priceTier de órdenes); `publicPrice` con tier por defecto; proyección pública expone solo el tier por defecto.
- Gate de design-system y typecheck cubren la eliminación de `PriceTier`/`TIER_LABELS` (compile break si algo queda cableado).

## previewChecks

1. `{ "path": "/", "steps": "Cambiar tienda → Administrar tienda", "selector": "text=Niveles de precio", "assert": "visible" }` — la sección existe en ajustes de la tienda tiered (nota: `StoreSettingsScreen` no tiene ruta URL; se abre desde el selector de tienda, `src/features/stores/StorePickerScreen.tsx:74`).
2. `{ "path": "/catalogo-admin/productos", "selector": "text=Menudeo", "assert": "visible" }` — el formulario muestra los labels de los tiers migrados (migración aplicada).
3. `{ "path": "/inventario", "selector": "text=Sugerido", "assert": "visible" }` — el asistente de precio sugerido aparece en la compra al capturar costo con regla configurada.
4. `{ "path": "/catalogo/{slug}", "selector": "text=/^\\$/", "assert": "visible" }` — el catálogo público muestra el precio del tier por defecto.

## Riesgos

- **Snapshot de labels:** órdenes guardan `priceTier` (id) y `price` (número); renombrar un label no rompe nada, borrar un tier deja órdenes históricas con id huérfano → mostrar el id como fallback o "—" (decisión menor en implementación).
- **Proyecciones stale:** si cambia `defaultTierId` o un label, republicar catálogo ya existe ("Republicar catálogo") y se reusa tras editar tiers.
