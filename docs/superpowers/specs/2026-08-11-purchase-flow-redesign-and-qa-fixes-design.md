# Rediseño del flujo de compra + fixes de QA

**Fecha:** 2026-08-11
**Estado:** 💡 idea → spec (pendiente aprobación)
**Solicitó:** Fer (dueña de Olivia), consolidado por QA de 3 subagentes

## Contexto

El QA de la app (3 subagentes contra local/dev) encontró 2 bloqueadores
funcionales, 3 bugs UX en el flujo de compra que Fer reportó, y 3 bugs UX
menores. Esta spec cubre **los 8 juntos** porque el rediseño del flujo de compra
tocca el `PurchaseForm`, y los fixes menores son rápidos y conviene meterlos en
el mismo ciclo antes de que Fer pruebe.

Alcance decidido con el PO: **todo incluido**.

## Bugs a arreglar

### 🔴 Bloqueadores

**B1 — Hoja "Proveedores" se abre vacía (proveedores inaccesibles)**
- Causa: `SuppliersScreen` lee `activeStore` del contexto global, que es `null`
  cuando se abre desde Ajustes de tienda (vía StorePicker, donde
  `activeStore === null`). El componente retorna null.
- Fix: `SuppliersScreen({ storeId }: { storeId: string })` — recibir la tienda
  por prop (patrón existente de `StoreSettingsScreen`), lookup con
  `state.stores.find`. Único invocador: `StoreSettingsScreen.tsx:283`, que ya
  tiene `storeId`.

**B2 — No se puede eliminar clientes desde la UI**
- Causa: `deleteCustomer` existe en el backend (`StoreProvider.tsx:440`) pero la
  UI no lo expone.
- Fix: en `CustomersScreen`, añadir un `Dropdown` (⋮) por tarjeta con "Editar" /
  "Eliminar", + `Dialog` de confirmación (patrón de `CatalogScreen`). Mostrar
  conteo de pedidos asociados en el diálogo (advertir, no bloquear).

### 🟠 Flujo de compra (lo que reportó Fer)

**F1 — Crear proveedor nuevo desde la compra**
- Hoy el select de Proveedor solo lista existentes (0 seed en dev).
- Fix: extraer `SupplierForm` a su módulo (hoy vive dentro de
  `SuppliersScreen.tsx`), y desde `PurchaseForm` abrirlo en un `Sheet` con un
  botón "+ Nuevo proveedor" junto al select. Al guardar, el proveedor entra a
  `state.suppliers` y el select lo selecciona automáticamente.

**F2 — Crear producto nuevo desde la línea de compra**
- Hoy cada línea solo elige productos existentes.
- Fix: mini-form de producto (nombre + costo + precio) en un `Sheet`, botón
  "+ Nuevo producto" por línea. Crea el producto **privado** por defecto (ver M1),
  lo añade a `state.products`, y la línea lo selecciona. El mini-form permite
  **publicarlo** en el mismo paso (toggle "Publicar en el catálogo") si Fer lo
  decide — al publicar, pasa la validación mínima (nombre + precio). Fer puede
  completar la ficha completa (foto, categoría, descripción) después.

**F3 — Editar precio de venta del producto al comprar**
- Hoy la compra solo actualiza `quantityOnHand` y `cost`.
- Fix: añadir campos de precio a la línea de compra (`Menudeo/Mayoreo/
  Emprendedora` para `inventory_tiered`; `Precio de venta` para `on_demand`),
  pre-poblados con el precio actual del producto. Al guardar, mergear los
  precios editados en el `upsertProduct`.
- Tipos: `PurchaseLine` += `price?: number; prices?: ProductPrices;`
  (opcionales, no rompen compras existentes).
- `applyPurchaseLines` **sin cambios** (responsabilidad acotada a stock+costo);
  los precios se mergean aparte en `submit`.
- **Efecto a confirmar:** editar precio desde la compra **republisha el
  catálogo público** (porque `upsertProduct` re-proyecta). Es deseable (Fer
  ajusta el precio al reponer stock → el cliente ve el nuevo precio).

### 🟡 Menores

**M1 — Producto nuevo nace PRIVADO por defecto (decisión del PO)**
- Decisión: **todo producto nuevo nace privado** (no visible en el catálogo
  público). Fer lo publica explícitamente cuando está listo (cambiar el estado a
  "Publicado"). Aplica tanto al crear desde Catálogo como desde la compra (F2).
- Fix: `newProduct()` en `StoreProvider.tsx:501` mantiene `status: "draft"` +
  `isPublic: false` (alineados) — NO cambiar a published. El bug original era que
  el default parecía inconsistente; ahora queda explícito: draft = privado.
- La validación de `ProductForm` (líneas 201-225) sigue blindando la publicación:
  para pasar a "Publicado" se exige precio + categoría + foto.

**M2 — Badge admin "Privado" inconsistente**
- Fix: `statusLabel`/`statusTone` en `CatalogScreen.tsx:36-45` gobernados solo
  por `status` (ignorar `isPublic` legacy), alineado con `selectors.ts` (la
  fuente de verdad pública). "Borrador" = privado (no visible), "Publicado" =
  visible. Sin el tercer estado ambiguo "Privado".

**M3 — Botones de pedido en participio**
- Fix: separar vocabulario. `orderStatus.ts` añade `ORDER_ACTION_VERBS`
  (imperativos: "Confirmar", "Comprar", "Marcar comprado", "Marcar llegada",
  "Entregar", "Cobrar") para los botones de avance; `ORDER_STATUS_LABELS`
  (participios) se mantiene para la badge de estado. Ajustar el toast de
  `OrderCard.tsx:38`.

## No está en esta spec (backlog)

- **Precios escalables** (nombres mutables + extensibles, `prices: {[tierId]:n}`
  + `Store.priceTiers`): feature con spec propia, ya en `docs/BACKLOG.md`.
- **Fórmula precio-sugerido desde el costo**: backlog.
- **Búsqueda/filtro de clientes**: gap UX, backlog.
- **`/catalogo` sin slug como directorio de tiendas**: revisar diseño aparte.
- **Cascade al borrar cliente** (pedidos huérfanos): por ahora se advierte en el
  diálogo, no se hace cascade.

## Plan de implementación (TDD, con subagentes)

Orden por dependencia:

1. **M3** (orderStatus imperativos) — independiente, rápido, con test.
2. **M1 + M2** (status published + badge) — acoplados, juntos.
3. **B1** (SuppliersScreen por prop) — fix estructural.
4. **B2** (eliminar clientes UI) — patrón Dropdown+Dialog existente.
5. **F1** (proveedor al vuelo) — extraer SupplierForm + Sheet en PurchaseForm.
6. **F3** (editar precio en línea) — extender PurchaseLine + merge en submit.
7. **F2** (producto al vuelo) — mini-form de producto + Sheet.

Cada paso: test pequeño primero (reglas/unit/UI), implementación, verificación
`typecheck && test && test:rules`. Al final, QA de regresión con subagente en
local cubriendo los 8 bugs + los flujos que ya funcionaban.

## Criterios de aceptación (validables en local, dev)

- B1: desde Ajustes de tienda (vía picker), la hoja Proveedores lista/crea
  proveedores (no vacía).
- B2: se puede eliminar un cliente desde su tarjeta (con confirmación).
- F1: en Nueva compra, "+ Nuevo proveedor" abre un form y el proveedor queda
  seleccionado.
- F2: en una línea de compra, "+ Nuevo producto" crea un producto mínimo y lo
  selecciona.
- F3: al editar precio en la línea de compra y guardar, el producto refleja el
  nuevo precio en el catálogo.
- M1: un producto nuevo nace privado por defecto (no visible en catálogo hasta
  que Fer lo publique explícitamente).
- M2: el badge admin coincide con la visibilidad pública real (Borrador=privado,
  Publicado=visible).
- M3: los botones de avance de pedido son imperativos.
- Sin regresiones: login, crear/editar producto, crear pedido, inventario ±,
  catálogo público sin fugas de datos privados — todo sigue funcionando.
- `npm run typecheck && npm run test && npm run test:rules` verdes.
