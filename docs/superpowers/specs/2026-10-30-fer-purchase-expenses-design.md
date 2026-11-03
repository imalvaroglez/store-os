Delivery-ID: fer-purchase-expenses
Delivery-Status: In progress
specPath: docs/superpowers/specs/2026-10-30-fer-purchase-expenses-design.md
discoveryId: FER-01
---

# Gastos de surtido en Compras (FER-01)

## Objetivo

Registrar en la compra del proveedor los gastos relacionados con surtir y
preparar la mercancía, de modo que Fer pueda consultar el importe del proveedor,
los gastos adicionales y el total registrado desde una sola compra.

## Decisiones para esta entrega

- El campo existente **Envío** se entiende como envío del proveedor y permanece
  dentro de la comparación entre el total calculado del proveedor y el total
  confirmado de su documento.
- Los nuevos gastos se guardan aparte en `Purchase.sourcingExpenses`. Cada gasto
  tiene una categoría, un importe y una descripción opcional.
- Categorías iniciales: traslado para surtir, entrega a clienta, empaque
  individual, bolsa compartida y otro gasto.
- El total confirmado del proveedor sigue siendo `Purchase.totalConfirmed`.
  Los gastos nuevos no alteran la revisión de diferencias ni bloquean la
  recepción de mercancía.
- La compra muestra el gasto adicional y el total registrado (total confirmado
  del proveedor más gastos adicionales). No se mezclan estos importes con el
  costo unitario de productos.
- Cada importe nuevo debe ser mayor que cero y se guarda en pesos con dos
  decimales. No se precargan los ejemplos de $44, $149, $150 o $22 como tarifas.
- Las compras anteriores sin `sourcingExpenses` muestran cero gastos; no se
  migran ni se reescriben.
- Importar un PDF no inventa ni calcula gastos de surtido. Se capturan
  manualmente en el editor.

## Fuera de alcance

- Repartir gastos entre líneas o calcular costo completo por pieza (FER-02).
- Cambiar `Product.cost`, cantidades de inventario o la lógica de recepción.
- Determinar si el empaque individual o compartido pertenece a cada pieza.
- Distribuir centavos sobrantes, prorratear un gasto, o aplicar gastos a varias
  compras.
- OCR, comprobantes adicionales, reportes, ganancias o cambios a cortes.

## Cambios

1. Añadir tipos `PurchaseExpenseCategory` y `PurchaseExpense`, y guardar una
   lista opcional `sourcingExpenses` dentro de `Purchase`.
2. Añadir funciones puras para sumar los gastos y el total registrado. No
   incorporarlas en `purchaseTotals` ni `recalcPurchaseStatus`, que siguen
   representando el documento y el pago al proveedor.
3. En `PurchaseForm`, permitir agregar, editar y quitar gastos con controles
   del sistema de diseño. El editor muestra la suma adicional y el total
   registrado. Compras recibidas muestran el desglose sin controles activos.
4. Validar gastos incompletos o no positivos antes de guardar. Captura de gastos
   no invalida una diferencia del documento del proveedor porque es un importe
   separado.
5. En el historial de Compras, mostrar el total confirmado del proveedor y, si
   existen, los gastos adicionales y el total registrado.

## Pruebas y aceptación

- Prueba unitaria: compra antigua sin gastos conserva el total registrado del
  proveedor; gastos de varias categorías se suman exactamente; el cálculo del
  proveedor y el estado de recepción no cambian al añadir gastos.
- E2E con emulador: crear y guardar una compra con traslado, entrega y empaque;
  reabrirla y verificar categorías, descripciones, importes y total. Confirmar
  que recibir la mercancía solo actualiza el inventario por las líneas. Capturar
  también $0.50 tecla por tecla y conservar ese importe al reabrir.
- `npm run typecheck`, `npm run test`, `npm run build` y `npm run e2e:firebase`.
- Revisión de UI en móvil y escritorio con Preview local.

## Consumo y ambientes

- Las operaciones de edición son locales. Guardar usa la escritura de compra ya
  existente; no se añaden lecturas o servicios cloud.
- Desarrollo y E2E usan únicamente `store-os-dev`; los emuladores escuchan en
  `127.0.0.1`. Producción solo se usa tras aprobación humana explícita.
