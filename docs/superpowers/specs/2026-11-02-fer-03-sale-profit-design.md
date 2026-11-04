Delivery-Id: fer-sale-profit
Delivery-Status: In progress
specPath: docs/superpowers/specs/2026-11-02-fer-03-sale-profit-design.md
discoveryId: FER-03
---
# Costo completo y ganancia por venta (FER-03)

Issue #127. Base: PR #167 (`codex/issue-126-allocation`, a su vez sobre #114),
sin mergear al abrir este PR. Si la base cambia, esta rama se rebasa.

## Objetivo

Al registrar y al ver una venta, mostrar la ganancia con costo completo:
**ganancia = precio vendido − costo de adquisición − gastos de venta por pieza**.
Sin ledger contable ni análisis histórico: la vista por venta, reconstruible.

## Delimitación frente a #114 y #167 (no duplicar)

- El costo de adquisición por pieza ya vive en `Product.cost` (compra + envío
  del ticket + traslado/gastos marcados; #114) y se congela en la línea al
  capturar el pedido (`OrderItem.cost`, existente). Aquí NO se recalcula.
- El gasto de venta por pieza ya está repartido con centavos exactos por #167
  (`PurchaseCostAllocation.saleExpenseCents` + `saleCostAdjustments`, NUNCA en
  `totalCents`/`Product.cost`). Aquí solo se CONSUME:
  `effectiveSaleExpenseCents`/`purchaseProductSaleCosts` de `src/lib/purchases.ts`.
- Nueva pieza mínima: `src/lib/saleProfit.ts` —
  `itemsProfitBreakdown`/`orderProfitBreakdown` → `{ revenueCents,
  acquisitionCents, saleExpenseCents, profitCents | null, linesWithoutCost }`.
  Centavos enteros siempre; `orderAmountCents` para pesos→centavos. Nunca NaN.

## Caso numérico para contrastar con Fer

Viaje (#114/#167): 70 aretes a $10.00 + $44.00 de traslado → adquisición
$744.00/70 = $10.6286/pieza. Entrega a clienta $25.00 repartida en 70 piezas
→ 35.71¢/pieza (FER-02 reparte 50 piezas con 36¢ y 20 con 35¢; la suma es
exactamente 2500¢).

Venta de 2 aretes a $25.00 c/u = $50.00:

| Concepto | Cálculo | Resultado |
|---|---|---|
| Precio vendido | 2 × $25.00 | $50.00 |
| Costo de compra | 2 × $10.6286 (redondeo exacto) | $21.26 |
| Gastos de venta | redondeo de 2 × 2500¢/70 | $0.71 |
| **Ganancia** | 5000¢ − 2126¢ − 71¢ | **$28.03** |

El efectivo vive aparte: si Fer cobró $20.00 de anticipo, el pedido muestra
Total $50.00 / Pagado $20.00 / Saldo $30.00 y la ganancia sigue siendo $28.03.
La ganancia NUNCA lee `deposit`.

## Reglas

1. **Precio negociado:** la ganancia usa el `unitPrice` congelado en la línea
   (ajustes manuales incluidos), no el catálogo.
2. **Gasto de venta por línea** = redondeo half-up exacto (aritmética entera)
   de `cantidad × centavosDelProducto / piezasCompradas`. El redondeo ocurre
   una vez por línea de venta, no por pieza.
3. **Un solo viaje cuenta:** la estimación por pieza sale del ÚLTIMO viaje
   recibido que compró ese producto en esa tienda (mismo espíritu que
   `latest_purchase` en #114). Los viajes anteriores no se vuelven a contar:
   sus piezas se vendieron antes.
4. **Sin costo conocido:** una línea sin `cost` queda fuera de la ganancia y se
   muestra como "N líneas sin costo"; si NINGUNA línea tiene costo, se muestra
   "sin costo registrado" y jamás una ganancia inventada.
5. **Devoluciones (definición adoptada):** pedido cancelado = devolución
   total → no se muestra ganancia (no realizada). La devolución parcial no
   existe en el modelo actual de pedidos; queda fuera de alcance hasta que
   exista como feature.
6. **Doble conteo:** imposible por construcción — el costo de adquisición
   (`OrderItem.cost` ← `Product.cost`) excluye por diseño los gastos de venta
   (#167), y aquí se suman una sola vez, del lado de la venta.

## Dónde se ve

- **Al registrar** (`OrderForm`): fila "Ganancia" en la barra de totales
  (— cuando no hay costo conocido) + nota "N líneas sin costo no cuentan".
- **Al ver** (`OrderCard`): "Ganancia estimada: $X · costo de compra $A ·
  gastos de venta $B" (+ "N líneas sin costo" si aplica; nada si cancelado).
  El efectivo sigue en Total/Pagado/Saldo, filas separadas.
- **Inicio** (`HomeScreen`): "Ganancia esperada" agrega con la MISMA regla
  (antes solo restaba costo de compra; quedaría inconsistente con la ficha).
- El detalle para compartir (cliente) NO incluye costos ni ganancia.

## Consumo y ambientes

- **0 lecturas y 0 escrituras nuevas de Firestore**: todo se calcula sobre
  datos ya cargados en memoria (`state.purchases`, `state.orders`). El
  aislamiento por tienda ya acota `state.purchases` (adaptador) y la estimación
  además filtra por `storeId`. Free tier intacto.
- Desarrollo y validación: `store-os-dev`; emuladores solo en CI; producción
  intocable.

## Decisiones adoptadas por autonomía del PO — reversibles

1. Gasto de venta estimado AL CONSULTAR con costos vigentes; no se congela un
   snapshot nuevo en la línea (la issue no lo exige y `OrderItem.cost` ya
   congela la adquisición). Reversible: añadir `OrderItem.saleExpenseCents`.
2. Solo el último viaje recibido alimenta la estimación por pieza. Reversible:
   promediar viajes o ledger.
3. Ganancia estimada sobre las líneas con costo; las demás se cuentan y se
   anuncian. Reversible: exigir costo para estimar.
4. Cancelado = devolución total sin ganancia mostrada. Reversible: feature de
   devoluciones parciales.
5. Inicio agrega la misma regla que la ficha. Reversible: dejarlo solo-venta.

## Validación

- Unitarias (`src/lib/saleProfit.test.ts`): centavos exactos, gasto de venta
  una sola vez, precio negociado, sin costo honesto, aislamiento por tienda,
  último viaje recibido gana (draft ignorado, legacy cuenta), ajustes
  posteriores incluidos, redondeo 2500¢/70, pliegue de líneas repetidas.
- UI: `OrderCard.test.tsx` (desglose, efectivo separado, sin costo, cancelado)
  y `OrderForm.test.tsx` (preview al registrar, — sin costo).
- `npm run typecheck && npm run test && npm run build` en verde local.

## Fuera de alcance

- Ledger contable, análisis histórico, re-costo retroactivo de ventas pasadas.
- Cobrar empaque/entrega al vender (`fer-order-payments`).
- Devoluciones parciales y su efecto en existencias/ganancia.
