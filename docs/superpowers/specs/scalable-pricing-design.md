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
  id: string;      // estable, p.ej. "t_retail" (uid() con prefijo). Nunca cambia tras crearse.
  label: string;   // cosmético, editable. p.ej. "Menudeo".
  order: number;   // orden de despliegue.
  hidden?: boolean; // oculto de forms/catálogo; NO borra claves de precio de productos.
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

### 2. Migración idempotente dedicada (persiste solo lo cambiado)

Extiende la migración existente en `src/lib/catalog.ts` (`migrateCatalog`, `:160-245`, ya corre en `StoreProvider.tsx:188,207` y `storage.ts:31`) con un paso dedicado que cubre **stores, products y orders**:

- Sube `CURRENT_PRODUCT_SCHEMA_VERSION` (`src/lib/catalog.ts`).
- Por tienda sin `priceTiers`: crea `priceTiers = [{id:"t_retail",label:"Menudeo",order:0},{id:"t_wholesale",label:"Mayoreo",order:1},{id:"t_reseller",label:"Emprendedora",order:2}]`, `defaultTierId = "t_retail"`. Sin `pricingRule` (asistente opt-in).
- Por producto con `schemaVersion` viejo: `prices = { t_retail: old.retail, t_wholesale: old.wholesale, t_reseller: old.reseller }` (claves undefined fuera). Órdenes existentes: `priceTier: "retail"` → `"t_retail"` (mapeo de los 3 valores).
- Re-corrida = no-op (schemaVersion + priceTiers presentes).
- **Persistencia explícita:** la migración no se queda en memoria — persiste **solo los documentos que cambiaron** (tiendas sin `priceTiers`, productos con schema viejo, órdenes con `priceTier` legacy), vía el adapter (`persistEntity` / batch existente, mismo patrón que el backfill de `publicProducts`). Documentos sin cambio = 0 writes.
- **Republicación única:** tras migrar, cada tienda afectada república su catálogo **una sola vez** (reusa la proyección existente de `publicStores`/`publicProducts`), no una vez por producto.
- **Cloud:** corre en cliente al cargar estado (`StoreProvider`), igual que hoy; no se requiere script de servidor. La migración persiste por el **adapter** (`persistEntity`, solo documentos cambiados) y república una vez por tienda; el guardado de tiers editados reutiliza `updateStore` (2 writes privados + proyección pública completa, contabilizada en §Costo, con propagación de error — ver abajo).

### 3. UI — edición de tiers (StoreSettingsScreen)

En `StoreSettingsScreen.tsx`, sección "Niveles de precio" (solo tiendas `inventory_tiered`):

- Lista de tiers: label editable (TextField), subir/bajar (order), **ocultar/mostrar** (un tier oculto desaparece de forms y catálogo pero **no se borra**: los productos conservan su clave de precio histórico), eliminar solo con confirmación explícita.
- "Agregar nivel": nuevo id generado con el generador existente `uid()` de `src/lib/ids.ts` (prefijo `t_`) — ids estables desde su creación, sin slug del label ni sufijos ad-hoc.
- Marcar cuál es el precio al público (`defaultTierId`, radio/Select). **Validación:** no se puede guardar con cero tiers visibles ni con `defaultTierId` apuntando a un tier inexistente u oculto (el form lo bloquea y el helper `defaultTier` hace fallback defensivo al primer tier visible).
- Regla de precio sugerido: un campo "Ganancia sobre costo (%)" que guarda `pricingRule` (vacío = sin asistente).

### 4. UI — forms y listas

- `ProductForm.tsx`: los 3 TextFields fijos (`:429` y hermanos) pasan a iterar `tiersForStore(activeStore)`. Junto al campo del tier por defecto, si `cost` y `pricingRule` existen: texto de ayuda "Sugerido: $X" y botón/chip "Usar" que llena el campo.
- `PurchaseForm.tsx`: el mapa sobre `["retail","wholesale","reseller"]` (`:201-209`) y los estados fijos (`:339-385`) iteran los tiers de la tienda con sus labels.
- `OrderForm.tsx`: `TIER_OPTIONS` se construye desde `tiersForStore(activeStore)`; `selectTier`/`selectProduct` usan tier ids string.
- `CatalogScreen.tsx:119`: label y valor del tier por defecto en la tarjeta de producto (texto "Menudeo" fijo → `defaultTier(store).label`). Nota: `InventoryScreen` ya no existirá — `unified-products` lo retira y mueve stats a las tarjetas; si esa entrega aún no cae, el mismo cambio aplica al listado de Inventario y desaparece al fusionarla.

### 5. Proyecciones públicas y reglas

- `src/app/firebase/firestoreData.ts:377,423`: el DTO público expone un **único `price` ya resuelto** (escalar: `prices[defaultTierId]`), nunca el mapa completo de precios ni precios privados (mayoreo, costos). Un cambio de `defaultTierId` se refleja al republicar.
- **Requisito de la implementación (no de este PR de spec):** retirar `prices` del allow-list público (`src/app/firebase/rules-allowlist.ts`) dejando únicamente `price`. Este PR sólo cambia la spec; el allow-list lo modifica la entrega de implementación.
- `firestore.rules` sin cambios: `priceTiers` vive en `stores` (plano de datos, ya cubierto por reglas de membresía); **no** se agrega a `adminStores` ni a su allow-list (`src/app/firebase/rules-allowlist.ts`) — es contenido de negocio, no control (G-P02).

## Alcance (out)

- Descuentos por volumen / pricing dinámico.
- Histórico de precios por producto.
- Regla de margen objetivo o tabla por rango de costo.
- Tier por defecto por clienta.

## Costo (free tier) — estimación corregida

- **Migración (una sola vez), por tienda afectada:** **2 writes privados de Store** (`stores` + `adminStores`; `saveEntity("stores")` siempre batchea ambos planos) + P writes de productos cambiados + O writes de órdenes cambiadas + **proyección pública completa**: 1 write de `publicStores/{slug}` + 1 de `publicCatalogs/{slug}` + 1 por cada `publicProduct` publicado (N), más las lecturas de la consulta de documentos públicos actuales y D borrados de obsoletos. Con el catálogo actual (~decenas de documentos) son decenas de writes/lecturas/borrados, una sola vez — muy por debajo de 50K lecturas, 20K writes y 20K borrados/día.
- **Edición interactiva de tiers:** cada guardado reutiliza `updateStore` — **2 writes privados** (`stores` + `adminStores`) y la **misma proyección pública completa** del punto anterior. Sin ruta especial ni optimización adicional.
- **Propagación de error en la proyección (requisito):** hoy `updateStore` silencia el error de `projectPublicForStore` (`src/app/StoreProvider.tsx:276`) — puede persistir el default privado, aparentar éxito y dejar el precio público anterior. Esta entrega lo corrige: si la proyección falla, el error **se propaga** (sin éxito falso; toast de error), el draft/configuración **se conserva** y se permite **reintentar** (los 2 writes privados ya hechos no se repiten innecesariamente; el reintento re-ejecuta la proyección). Con test que falle la proyección y afirme: error visible, sin toast de éxito, datos privados persistidos, proyección anterior intacta, reintento exitoso la completa.
- Guardar producto/orden: mismo número de writes que hoy (el mapa `prices` es el mismo campo).
- Sin dependencias nuevas, sin Functions, sin Storage extra.

## Pruebas

- Unit (`vitest`): `suggestedPrice` (markup, redondeo, sin costo → undefined); `tiersForStore` (orden, ocultos filtrados, fallback canónico; `defaultTier` nunca devuelve un tier inexistente/oculto); migración idempotente (legacy prices → t_* y re-run no-op; priceTier de órdenes; **solo documentos cambiados se persisten**); `publicPrice` con tier por defecto; proyección pública expone un único `price` resuelto y nunca el mapa ni precios privados.
- Gate de design-system y typecheck cubren la eliminación de `PriceTier`/`TIER_LABELS` (compile break si algo queda cableado).

## previewChecks

```json
[
  { "path": "/", "selector": "body", "text": "Entrar" }
]
```

(Humo de arranque; migración, proyección pública y asistente quedan cubiertos por
los tests unitarios y e2e.)

## Riesgos

- **Snapshot de labels:** órdenes guardan `priceTier` (id) y `price` (número); renombrar un label no rompe nada. **Ocultar** un tier conserva las claves históricas de productos; eliminarlo (confirmación explícita) deja órdenes históricas con id huérfano → mostrar "—" como fallback.
- **Proyecciones stale:** la migración persiste por adapter y república una vez por tienda; cada guardado de tiers usa `updateStore`, que dispara la proyección completa (con propagación de error — sin éxito falso si la proyección falla). No se promete republicación manual para este cambio de tiers.
