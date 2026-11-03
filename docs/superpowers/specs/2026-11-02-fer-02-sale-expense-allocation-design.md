Delivery-Id: fer-cost-allocation
Delivery-Status: In progress
specPath: docs/superpowers/specs/2026-11-02-fer-02-sale-expense-allocation-design.md
discoveryId: FER-02
---
# Reparto de gastos y empaques por pieza (FER-02)

Issue #126. Base: PR #114 (compras por viaje y costo completo de inventario),
sin mergear al abrir este PR. Si #114 cambia, esta rama se rebasa.

## Objetivo

Cerrar el reparto pendiente de la issue #126: los gastos y empaques de venta
(entrega a clienta, empaque individual, bolsa compartida) capturados en el
viaje quedan repartidos por pieza con centavos exactos, conservando los
totales y sin contarlos dos veces.

## Delimitación frente a #114 (criterio 1: no rehacer)

Se acepta íntegro el alcance de #114; nada de eso se reconstruye aquí:

- Viaje = una compra con varios tickets (`Purchase.tickets`,
  `PurchaseLine.ticketId`), incluso de proveedores distintos.
- Costo de adquisición por pieza: envío por piezas del ticket; traslado y
  gastos marcados por piezas de todo el viaje; descuento e impuesto adicional
  por valor de los productos del ticket.
- Centavos exactos por mayor residuo con desempate estable por `lineId`.
- `costingMethod: latest_purchase`; el costo completo de adquisición de la
  última compra recibida reemplaza `Product.cost` sin promediar existencias.
- `costAllocations` persistidas en la recepción como evidencia; recepción
  idempotente y transaccional.

## Definiciones adoptadas (criterio 2: definir y evitar doble conteo)

1. **Gastos de venta** = `customer_delivery`, `individual_packaging`,
   `shared_packaging`. Se consumen al vender, no al adquirir.
2. Un gasto de venta se reparte por pieza como **estimación de costo de
   venta** y NUNCA entra al costo del inventario (`totalCents`,
   `Product.cost`). Razón: FER-03 cobrará empaque/entrega al vender; si hoy
   se metieran al costo de la pieza, mañana se contarían dos veces.
3. `sourcing_transport` (traslado para surtir) y `other` conservan el
   comportamiento confirmado de #114: el traslado entra por defecto al costo
   del inventario; `other` solo si se marca. La casilla "Costo del
   inventario" ya no se ofrece para categorías de venta (el dato
   `includeInInventoryCost: true` sigue respetándose si existiera, moviendo
   el gasto al lado de adquisición — nunca a ambos).
4. Cada peso se cuenta una sola vez: un gasto o es de adquisición (entra a
   `sourcingExpenseCents`) o es de venta (entra a `saleExpenseCents`) o es
   `other` sin marcar (solo desembolso). El envío del proveedor vive en su
   ticket; el traslado de Fer vive en gastos; la UI los distingue.

## Reglas de reparto con ejemplos de centavos

- Peso = cantidad de piezas de cada línea (todo el viaje), igual que el
  traslado en #114; mayor residuo, desempate por `lineId`, aritmética entera.
- $25.00 de entrega entre 70 piezas: 2500¢ → 50 piezas con 36¢ y 20 con 35¢;
  la suma es exactamente 2500¢.
- $25.00 entre líneas de 2 y 1 pieza: 5000/3 y 2500/3 → 1667¢ + 833¢ = 2500¢
  (el mayor residuo gana el centavo).
- $0.50 entre 2 y 1 piezas: 33¢ + 17¢ = 50¢.
- Sin gastos: `saleExpenseCents` = 0 y el costo directo no cambia.

## Modelo de datos

- `PurchaseCostAllocation.saleExpenseCents?` (centavos enteros por línea,
  excluido deliberadamente de `totalCents`). Se persiste en la MISMA
  escritura de recepción: costo adicional Firestore = 0.
- `Purchase.saleCostAdjustments?: PurchaseExpenseAdjustment[]`, donde cada
  entrada = `{ id, at, category, amount, description?, allocations? }` con
  `allocations` (por línea, centavos exactos) solo para categorías de venta.
- `purchaseRecordedTotal` = proveedor + gastos de surtido + ajustes
  posteriores (el desembolso real registrado).

## Ajustes después de recibir (reajuste, con evidencia)

- Solo compras recibidas con `costingMethod: latest_purchase`.
- Una transacción cloud agrega UNA entrada append-only; toca exactamente
  `saleCostAdjustments` + `updatedAt`. Las reglas de Firestore permiten solo
  esas llaves sobre evidencia recibida (mismo patrón `diff().affectedKeys()`
  que la invitación de miembros): tickets, líneas, totales, `costAllocations`,
  stock y costos de producto son inmutables tras la recepción.
- El costo del inventario NO cambia con un ajuste posterior: las piezas ya
  recibidas conservan su costo completo de adquisición (re-abrirlo exigiría
  un ledger de inventario, fuera de alcance).
- Evidencia: la entrada guarda fecha y su reparto exacto; nada previo se
  reescribe ni se destruye.

## Consumo y ambientes

- Recepción: 0 operaciones nuevas (mismas lecturas/escrituras que #114).
- Un reajuste: 1 lectura previa + transacción (1 lectura + 1 escritura) +
  la sincronización por listener ya existente ≈ **2–3 lecturas y 1–2
  escrituras** por operación, sin colecciones ni servicios nuevos. Con la
  cuota diaria de 50K/20K, harían falta decenas de miles de reajustes diarios
  para acercarse al límite; uso real proyectado: unos pocos por semana.
- Desarrollo y validación usan `store-os-dev`; los emuladores solo en CI.
  Producción intocable.

## Decisiones adoptadas por autonomía del PO — reversibles

1. Categorías de venta SIN casilla de costo de inventario (el doble conteo
   con FER-03 es el riesgo que la issue pide evitar). Reversible: restaurar
   la casilla y el flujo `includeInInventoryCost` para esas categorías.
2. El reajuste posterior nunca cambia el costo del inventario ya recibido.
   Reversible: diseñar re-costo con ledger (requiere issue propia).
3. Reparto de gastos de venta por cantidad de piezas (igual que el traslado
   confirmado en #114), no por valor de la pieza. Reversible: cambiar los
   pesos en `purchaseCostAllocation`/`purchaseExpenseAdjustment`.
4. `other` sin marcar no se reparte (solo desembolso). Reversible: sumarlo a
   la estimación de venta con un marcador explícito.

## Validación

- Unitarias (`src/lib/purchases.test.ts`): reparto exacto con residuo
  explícito y suma exacta; viaje multitienda/multiproveedor; gasto marcado
  nunca cuenta en ambos lados; sin gastos el costo directo no cambia;
  ajuste posterior con centavos exactos, rechazo de importes no positivos y
  de líneas sin identidad.
- Formulario (`PurchaseForm.test.tsx`): caption de gasto de venta sin casilla
  de inventario, fila "Gastos de venta repartidos", alta de gasto después de
  recibir con evidencia visible, importe inválido rechazado y error de
  Firestore explicado en español.
- Reglas (`firestore.rules.test.ts`, corre en CI con emulador): append-only
  permitido sobre compra recibida; cualquier otra mutación de la evidencia
  sigue denegada.
- `npm run typecheck && npm run test && npm run build` en verde local.

## Fuera de alcance

- Cobrar empaque/entrega al vender (FER-03) y el costo/ganancia por venta.
- Ledger de inventario, re-costo retroactivo de piezas vendidas.
- Migrar compras recibidas antes de este cambio (su evidencia no se
  recalcula; `saleExpenseCents` ausente se lee como cero).
