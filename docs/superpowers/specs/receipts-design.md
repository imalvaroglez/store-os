---
Delivery-ID: receipts
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/receipts-design.md
---
# Recibos / comprobantes de venta imprimibles y PDF

## Problema

Fer quiere entregar a sus clientas un comprobante profesional cuando concreta
una venta: un recibo con el diseño de su marca, imprimible o compartible como
PDF (por WhatsApp). Hoy Store OS registra el pedido pero no genera ningún
documento para la clienta.

**Bloqueo estructural verificado en código:** `Order`
(`src/types/index.ts:191-207`) todavía modela **una línea por Order**
(`productId?`, `productName`, `quantity`, `price`, `cost` singulares). Un recibo
de venta real agrupa varias líneas (1 venta = N productos), como `Purchase`
ya hace con `PurchaseLine[]` (`src/types/inventory.ts`, usado en
`PurchaseForm.tsx`). Emitir recibos sin rediseñar `Order` produciría un recibo
por producto — inaceptable. Por eso esta entrega incluye el rediseño de
`Order` (decisión PO 2026-08-11) como fundamento.

## Objetivo

1. Rediseñar `Order`: de campos singulares a `{ items: OrderLine[] }` — una
   venta = un Order con N líneas (paridad con `Purchase.lines`).
2. Migración idempotente de Orders existentes (cada Order viejo → Order nuevo
   con exactamente 1 item).
3. Rediseñar `OrderForm` para capturar varias líneas.
4. Recibo imprimible/PDF por Order: `window.print()` + CSS `@media print`,
   tamaño carta, plantilla fija con la marca de Olivia (referencia Canva de
   Fer), mostrado en un Sheet existente (sin ruta nueva).
5. Folio consecutivo por tienda (`receiptSeq`, p. ej. `REC-0001`), asignado en
   la MISMA transacción que crea el Order.

**Sin campos fiscales (decisión PO 2026-08-18):** esto es un recibo, no un
CFDI. No hay claves SAT (`01/03/04/99`), ni `G03`, ni `H87`, ni RFC de clienta,
ni régimen fiscal de tienda. Con ello desaparece la PII fiscal y el trabajo
ARCO asociado. Si algún día se factura, será otra entrega con su propio diseño.

## Alcance (in)

### 1. Modelo: `OrderLine` y nuevo `Order`

```ts
// English identifiers; one line of a sale: product, qty, unit price, unit cost.
export type OrderLine = {
  productId?: string;
  name: string;      // snapshot at sale time
  quantity: number;
  price: number;     // unit price actually charged (already tier-resolved)
  cost?: number;     // unit cost snapshot, for margin views
};

export type Order = {
  id: string;
  storeId: string;
  customerId: string;
  items: OrderLine[];        // >= 1
  deposit: number;           // anticipo (total de la venta, no por línea)
  status: OrderStatus;
  promisedDate?: string;
  notes?: string;
  priceTier?: PriceTier;     // tier aplicado al armar las líneas
  paymentMethod?: string;    // etiqueta simple en español ("Efectivo", "Transferencia"), opcional — sin claves SAT
  // Recibo
  receiptFolio?: string;     // "REC-0001"; asignado al crear el Order
  receiptIssuedAt?: string;
  schemaVersion?: number;    // para migración idempotente
  createdAt: string;
  updatedAt: string;
};
```

- `total` del recibo = `sum(items[].quantity * price)`; `balance` =
  `total − deposit`. Ambos se calculan (nunca se almacenan) vía helpers en
  `src/lib/` con test pequeño (regla de comprobación mínima).
- Los campos singular viejos (`productId`, `productName`, `quantity`, `price`,
  `cost`) se eliminan del tipo — la migración los convierte, no se conservan.

### 2. Migración idempotente de Orders

- Patrón ya probado en el repo: `schemaVersion` en el documento + migración
  bajo demanda (como `Product.schemaVersion`, ver
  `2026-08-11-purchase-flow-redesign` y el backfill de `publicProducts`).
- Cada Order viejo → nuevo con `items: [{ productId, name: productName,
  quantity, price, cost }]` y `schemaVersion: 2`. Re-ejecutar la migración
  sobre documentos ya migrados es no-op.
- Corre en el cliente al cargar Orders (modo demo y cloud vía el adapter),
  escribiendo solo los documentos que faltan — sin Cloud Function, sin costo.
- No se tocan `publicProducts` ni `adminStores` (Orders no tiene proyección
  pública).

### 3. `OrderForm` multi-línea y reservas por producto

- Rediseño de `src/features/orders/OrderForm.tsx` tomando como patrón
  `PurchaseForm.tsx`: selector de producto por línea, cantidad, precio unitario
  (resuelto por tier si el producto tiene `prices`), línea nueva / quitar
  línea, y total + saldo visibles al capturar.
- Forma de pago: etiqueta opcional en español ("Efectivo", "Transferencia",
  …). Sin campos fiscales (ver Objetivo).
- **Reservas de inventario por producto:** en stores `inventory_tiered`, las
  líneas del Order reservan existencia — el "comprometido" por producto suma
  las cantidades de TODAS las líneas de ese producto en pedidos abiertos
  (agregación en `src/lib/selectors.ts` sobre `items[]`, mismo criterio que hoy
  aplica el Order singular). Un producto puede aparecer en varias líneas; la
  reserva se calcula sobre el total por producto, no por línea.
- Spanish UI (México); mobile-first (tap targets ≥ 40px, inputs ≥ 16px);
  solo componentes del design system (`src/design-system/`).

### 4. Recibo imprimible (plantilla Olivia, tamaño carta)

- El recibo se muestra en un **Sheet existente del design system** (como los
  formularios de compra/producto), abierto con "Ver recibo" desde `OrderCard`.
  **Sin ruta nueva ni pantalla propia.**
- Es una **proyección de solo lectura** de datos existentes (como el catálogo
  público): no hay colección nueva.
- Contenido: encabezado con marca de Olivia (logo/colores de la tienda),
  folio, fecha, datos de la clienta (nombre/teléfono resueltos por
  `customerId`), tabla de líneas (producto, cantidad, precio unitario,
  importe), total, anticipo, saldo, forma de pago cuando exista,
  notas/promisedDate cuando existan, pie con datos de contacto (WhatsApp de la
  tienda).
- Plantilla fija reconstruida en HTML/CSS a partir de la referencia Canva de
  Fer (Canva es origen del diseño, NO el motor; no se carga ningún archivo de
  Canva en runtime). **Condición real de inicio:** la implementación no
  arranca hasta tener el PDF exportado de Canva de Fer; no se sustituye
  silenciosamente con una plantilla genérica.
- **PDF/impresión:** botón "Imprimir / Guardar PDF" → `window.print()` con CSS
  `@media print` + `@page { size: letter; margin: 12mm }`. El diálogo del
  navegador/OS ya ofrece "Guardar como PDF" (incluye Android/iOS → compartir a
  WhatsApp). **Cero dependencias nuevas de PDF** (no jsPDF/pdfmake) y cero
  servicios: todo en el cliente, sin Function de render.
- **Folio en la misma transacción que el Order:** al crear la venta (cloud), una
  sola transacción Firestore hace las tres cosas juntas — crea el Order, le
  asigna `receiptFolio = "REC-" + pad4(store.receiptSeq + 1)` y incrementa
  `receiptSeq` en `Store`. Sin incrementos por separado (permiten huecos o
  falsos éxitos). Si la transacción falla, no hay pedido ni folio: **no se
  imprime nada y no se muestra éxito**; se notifica el error y la dueña
  reintenta. En modo demo (sin backend) el folio se asigna localmente con el
  mismo sequential. El botón "Imprimir" del Sheet sólo habilita cuando el Order
  ya tiene folio.

### 5. Ajustes menores por el rediseño de Order

- `OrderCard`, `orderStatus.ts`, selectores de `src/lib/selectors.ts` y
  cualquier agregado (disponible/comprometido) pasan a leer `items[]`.
- El catálogo público no cambia (`Order` no participa en proyecciones
  públicas).
- **Reglas:** la transacción de folio escribe `receiptSeq` en `Store` y su
  espejo `adminStores`. Nueva rama en `firestore.rules` que permite a un
  miembro actualizar **únicamente** `receiptSeq` (diferencia exacta: +1) en
  ambos documentos; ningún otro campo. Cubierta en `npm run test:rules`.

## Alcance (out)

- Facturación fiscal / CFDI / timbrado PAC y cualquier campo fiscal
  (claves SAT, uso, unidad, RFC, régimen): fuera de alcance por decisión PO
  2026-08-18 — es un recibo, no un CFDI.
- Diseñador visual de plantillas embebido (YAGNI).
- Envío automático por WhatsApp (Fer comparte el PDF desde su teléfono).
- Plantillas multi-tienda parametrizadas: la plantilla se escribe por-tienda
  (lee tokens/branding de `Store`) pero solo se pule la de Olivia.
- Ticket térmico 58/80mm (decisión cerrada: carta/A4).

## Cero-costos (verificación explícita)

- Sin PDF-as-a-service, sin librerías de PDF, sin Cloud Function de render.
- Migración = escrituras puntuales una sola vez por documento (≈ #Orders
  existentes, cuota muy por debajo de 20K/día); folio = la transacción de
  creación del Order (2 escrituras: Order + Store) — cero escrituras extra.
- Sin telemetría; sin PII nueva (los datos del recibo ya viven en
  `Order`/`Customer`, sujetos a las mismas reglas G-P01–G-P08).

## Criterios de aceptación

1. Un Order nuevo creado con 2+ líneas persistece una sola venta con N items;
   el recibo lista todas las líneas con total = suma de importes.
2. Orders creados antes de la migración se ven y se imprimen como recibos de 1
   línea tras migrar; re-cargar no re-migra (`schemaVersion`).
3. "Imprimir / Guardar PDF" abre el diálogo de impresión del navegador
   (`window.print`), sin dependencias nuevas en `package.json`.
4. El folio es consecutivo por tienda (`REC-0001`, `REC-0002`, …), asignado en
   la misma transacción que crea el Order; si la transacción falla, no existe
   el pedido ni el folio y no se muestra éxito.
5. En stores inventory_tiered, el "comprometido" por producto refleja todas las
   líneas de los pedidos abiertos (incluye pedidos multi-línea con el mismo
   producto repetido).
6. `npm run typecheck && npm run test && npm run build` verdes; helpers de
   total/balance y migración con test pequeño; `npm run test:rules` cubre la
   rama de `receiptSeq`; e2e smoke existente no regresa.
7. UI 100% español, solo design system, mobile-first.

## previewChecks

```json
[
  { "path": "/", "selector": "body", "text": "Entrar" }
]
```

(Humo de arranque; el flujo de recibo queda cubierto por tests y e2e.)

## Notas de implementación

- `parseAmount` (`src/lib/money.ts`) para toda coerción numérica; nunca `NaN`
  al estado.
- El Sheet de recibo usa tokens de tema, no colores hardcodeados (regla de
  comportamiento sin sorpresas); el CSS `@media print` sí puede fijar medidas
  en mm porque es papel, no pantalla.
- **Bloqueo de inicio:** sin el PDF exportado de Canva de Fer no arranca la
  implementación (condición real, sin fallback genérico silencioso).
