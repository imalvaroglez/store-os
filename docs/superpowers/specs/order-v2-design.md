---
Delivery-ID: order-v2
Delivery-Status: In review
specPath: docs/superpowers/specs/order-v2-design.md
---

# Pedidos v2: multi-línea, ciclo propio y pago derivado

## Problema

`Order` modelaba **una línea por pedido** (`productName`/`quantity`/`price`/
`cost` singulares), el pago vivía dentro del estatus (`paid` = "Cobrado") y el
flujo mezclaba la logística de la dueña (comprar piezas, esperar llegada) con
el ciclo de la clienta. Una venta real agrupa varias líneas (paridad con
`Purchase.lines`), y "cobrado" no es un paso del flujo: es un hecho económico
que puede ocurrir en cualquier momento (anticipo, liquidación, pago tardío).

**Relación con `receipts`:** esta entrega es el **paso 1** (§1–§3) de
`receipts-design.md` — el rediseño de `Order` como fundamento. El recibo
imprimible + folio transaccional (§4–§5 de aquel spec: `receiptFolio`,
`receiptSeq`, 3 writes, reglas, gate, Sheet con `@media print`) queda para el
paso 2 y **no está en este cambio**.

## Objetivo

1. `Order` multi-línea: `items: OrderItem[]`, un pedido = N líneas.
2. Migración idempotente de pedidos existentes (demo + cloud).
3. `OrderForm` multi-línea con búsqueda de producto/cliente y totales en vivo.
4. Ciclo de pedido propio de la dueña, con el pago como estado derivado.
5. Reservas de inventario por producto agregadas de todas las líneas.

## Modelo

```ts
export type OrderItem = {
  productId?: string;     // línea de catálogo (reserva stock) o personalizada
  productName: string;    // snapshot al momento de la venta
  quantity: number;       // entero > 0
  priceTier?: string;     // tier snapshot POR LÍNEA
  unitPrice: number;      // precio cobrado (ya resuelto por tier)
  subtotal: number;       // quantity * unitPrice
  cost?: number;          // costo unitario snapshot, para margen
};

export type Order = {
  id: string; storeId: string; customerId: string;
  items: OrderItem[];
  deposit: number;                    // anticipo (total del pedido)
  orderStatus: OrderStatus;           // ciclo logístico
  paymentStatus: PaymentStatus;       // DERIVADO: unpaid | partial | paid
  promisedDate?: string; notes?: string;
  schemaVersion?: number;             // 2
  createdAt: string; updatedAt: string;
};
```

- Campos singulares viejos quedan en el tipo como **compat de solo lectura**
  (una pasada de migración + fixtures viejos); los writes nuevos jamás los
  incluyen. Desviación deliberada del spec receipts original (que pedía
  eliminarlos): conservarlos un ciclo hace la migración reversible y permite
  que clientes con bundle cacheado no corrompan docs.
- **Totales siempre derivados** (`orderTotals` en `src/lib/orders.ts`):
  `estimatedTotal = Σ qty×unitPrice`, `balance = max(0, total − deposit)`,
  nunca almacenados.
- **`paymentStatus` derivado** de `deposit` vs total (un pedido de $0 está
  pagado por definición). Desviación del spec receipts: en lugar de
  `paymentMethod` (etiqueta), el hecho observable es cuánto se ha cobrado.

### Ciclo de pedido (decisión de ciclo, extra vs spec receipts)

```
asked → quoted → confirmed → preparing → ready → delivered
                                                  (cualquier estatus → cancelled)
```

- Verbos de acción = imperativos del ESTADO DESTINO ("Cotizar", "Confirmar",
  "Preparar", "Marcar listo", "Entregar"); etiquetas = participles.
- `paid` deja de existir como estatus. Cobrar = acción "Cobrar" disponible
  cuando `balance > 0` (sube `deposit` al total); el `paymentStatus` se re-deriva.
- Mapeo legacy: `to_buy`/`bought`→`preparing`, `arrived`→`ready`,
  `paid`→`delivered` **con `deposit` elevado al total** (v1 avanzaba a `paid`
  sin tocar `deposit`; sin esto cada venta cobrada migraría con saldo fantasma).

### Reservas de inventario (modelo de contribución)

`reservationDeltasForOrderChange` es una función de contribución sin estado:
**abierto y entregado retienen stock** (reservado o consumido — fuera del
anaquel), **cancelado no retiene nada**. Cancelar una venta entregada devuelve
las piezas; re-entregar las vuelve a tomar; cualquier ciclo
(`open→delivered→cancelled→delivered`) netea exactamente un consumo. Sin flag
de proveniencia: la simetría lo hace innecesario.

### Escritura cloud atómica

`saveOrderWithStockTx` (`firestoreData.ts`): el pedido (snapshot canónico,
`merge:false` para botar campos legacy) + TODOS los ajustes de
`quantityOnHand` en **un solo `writeBatch`**. El estado local se confirma solo
tras el commit exitoso, así el reintento que invita el toast re-aplica el delta
completo — un write parcial N+1 podía doble-reservar o dejar una reserva
fantasma para siempre. ponytail: batch, no transacción — re-derivar deltas de
docs canónicos chocaría con la trampa de missing-docs en reglas y costaría
lecturas extra; ediciones concurrentes del mismo pedido convergen por snapshot
(como en v1).

## Alcance (in)

- `src/lib/orders.ts`: helpers puros (`orderItems`, `orderTotals`,
  `paymentStatusForOrder`, `effectiveOrderStatus`, `orderBucket`,
  `orderCountsTowardToPay`, `migrateOrder(s)`, `tierWarning`) con test.
- `OrderEditorScreen` en `/pedidos/nuevo` y `/pedidos/:id` (deep-link con
  aislamiento por tienda; `key={sub}` para remontar entre ediciones).
- `OrderForm` multi-línea: `SearchSelect` (combobox nuevo del design system)
  para producto y cliente, cliente inline vía `Dialog`, sanitización numérica
  estricta (`sanitizeIntegerInput`/`sanitizeDecimalInput`), barra sticky de
  totales.
- `OrdersScreen`: filtros KPI (Todos/Activos/Pendientes/Completados/Cancelados,
  `aria-pressed`) + búsqueda (referencia/cliente/producto).
- `OrderCard`: referencia corta (`#ABC123`), badges de estatus + pago, acción
  de avance + **Cobrar** cuando hay saldo.
- `CustomersScreen`: búsqueda (nombre/teléfono/Instagram) + campo Instagram.
- Inicio: pedidos pendientes y activos, ganancia esperada por línea,
  "Falta cobrar" unificado con Clientes vía `orderCountsTowardToPay`.
- Migración: corre al cargar (demo y cloud, incl. cada snapshot), persiste
  solo los docs que cambian (1 write por pedido legacy — muy por debajo de la
  cuota); `e2e/seed.ts` siembra v1 plano a propósito para ejercer el camino.

## Alcance (out)

- El recibo imprimible, folio `REC-0001`, `receiptSeq`, transacción de 3
  writes, reglas y gate anti-writers (todo §4–§5 de receipts).
- `paymentMethod` (etiqueta de forma de pago).
- Cancelación con confirmación/dedicated action (hoy vía el selector de
  estatus del editor) — candidato a backlog.
- Historial de cobros parciales (hoy un solo `deposit`).

## Cero-costos

- Migración: 1 escritura por pedido legacy existente, una sola vez.
- Guardar pedido pasa de N+1 writes a 1 batch (N líneas + 1 pedido + stock).
- Sin servicios nuevos, sin Functions, sin dependencias.

## Criterios de aceptación

1. Un pedido nuevo con 2+ líneas persiste una sola venta con N items; totales
   y saldo correctos en la barra y en la tarjeta.
2. Pedidos legacy se migran al cargar (demo y cloud) y la re-carga no
   re-migra ni re-escribe (`schemaVersion` 2 + identity-compare).
3. Legacy `paid` migra sin saldo fantasma (deposit elevado al total).
4. El ciclo delivered→cancelled→delivered nunca consume stock doble (test del
   ciclo en `inventory.test.ts`).
5. "Cobrar" de un tap disponible cuando hay saldo, en tarjeta y en Inicio.
6. El deep-link `/pedidos/:id` de otra tienda muestra "Pedido no encontrado".
7. `npm run typecheck && npm run test && npm run build` verdes;
   `npm run e2e:firebase` verde (6 pruebas nuevas del flujo).
8. UI 100% español (México), solo design system, mobile-first.

## previewChecks

```json
[{ "path": "/pedidos/nuevo", "selector": "body", "text": "Productos" }]
```
