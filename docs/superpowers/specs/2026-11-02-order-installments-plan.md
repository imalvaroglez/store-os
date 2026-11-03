# Plan de pagos configurable por pedido (#165) — reglas de dinero y stock

Fecha: 2026-11-02 · Rama: `codex/issue-165-installments` (apilada sobre `codex/issue-123-payments`, PR #166) · Refs #165 (define #123)

Decisiones adoptadas por autonomía del PO (comentario en #165, 2026-11-02) —
rigen; no se re-preguntan. Este documento es la spec excepcional de reglas de
dinero/stock que viaja dentro del PR de código.

## Reglas adoptadas

1. **La modalidad vive en el pedido.** Interruptor "Pagos por partes" en
   `OrderForm`; al activarlo se capturan número de cuotas (1–99, sin default),
   frecuencia (Semanal/Quincenal/Mensual, elección explícita) y primera fecha
   de vencimiento. Las fechas siguientes se derivan; los meses inexistentes se
   ajustan al último día (ene 31 → feb 28/29). No existe fecha límite de
   liquidación distinta de la fecha prometida. Nada de esto toca la ficha ni
   los niveles de precio del producto.
2. **Importes sugeridos, nunca almacenados.** Cuota = total VIGENTE ÷ número
   de cuotas, en centavos exactos (`splitInstallmentCents`); el residuo de la
   división se asigna explícito a las cuotas más próximas y Σ cuotas == total.
   El acuerdo (importes + fechas + última fecha) se muestra ANTES de guardar.
   Un cambio de total posterior re-deriva el calendario contra el total nuevo
   (los cobros quedan intactos; saldo recalculado — decisión iv de #123).
3. **Abonos = los mismos cobros de #123.** Sin segundo acumulado: recibido y
   saldo se reconstruyen con `paymentSummary` sobre los mismos registros. Un
   abono cubre primero la cuota con vencimiento más próximo y el sobrante pasa
   a la siguiente (waterfall sobre Σ recibido); el número de recibos ≠ cuotas
   cumplidas. El atraso se muestra informativo (`Atrasada`), sin penalización:
   no existen intereses ni cargos en el modelo.
4. **Reserva al primer abono, una sola vez.** Un plan sin abonos NO aparta
   piezas (extensión del modelo de contribución de `inventory.ts`). El PRIMER
   abono positivo confirmado (`kind: "payment"`, monto > 0) reserva las
   cantidades del pedido en la MISMA transacción que registra el cobro:
   stock canónico re-leído, marca `installmentsReservedAt` + `revision`
   escritas atómicamente. Reintentos (mismo id), doble clic, abonos posteriores
   y concurrencia (reintento de transacción) nunca vuelven a reservar; un
   editor con estado viejo aborta con `StaleOrderError` en lugar de liberar en
   silencio. Pedidos ordinarios conservan su reserva temprana.
5. **Sin existencias al primer abono** → `InsufficientStockError`: el abono NO
   se registra, sin stock negativo ni reserva silenciosa. *Pendiente de PO —
   reversible:* si se permite registrar el abono sin reserva (bajo pedido) o se
   mantiene el bloqueo; hoy bloquea.
6. **Entrega al liquidar, confirmación manual.** La transición hacia
   `delivered` en un pedido con plan se rechaza con `DeliveryWithBalanceError`
   en `saveOrderWithStockTx` (camino de mutación, no solo botones ocultos)
   mientras exista saldo. Liquidar HABILITA entregar; no marca nada
   automáticamente. Pedidos ordinarios conservan su comportamiento.
7. **Cancelación no infiere.** Cancelar un pedido a plazos YA reservado NO
   libera stock ni devuelve dinero: las piezas siguen apartadas hasta que la
   operadora lo resuelva explícitamente (ajuste de inventario; devolución =
   ajuste con signo y nota de #123). Un plan sin abonos cancelado no tiene
   nada que liberar.
8. **Edición post-cobro con evidencia.** Cambiar o quitar el plan conserva el
   acuerdo anterior verbatim en `installmentsHistory` (nunca se reescribe).
   Convertir en plan un pedido que ya recibió dinero marca la reserva de inmediato
   (sin delta de stock: un pedido abierto ordinario ya tenía las piezas).
   Quitar el plan de un pedido reservado no libera las piezas.

## Modelo

- `Order.installments?: { count, frequency, firstDueDate, agreedAt?, agreedBy? }`
  + `installmentsReservedAt?` (marca idempotente) + `installmentsHistory?`.
  `migrateOrder` los pasa verbatim (o los descarta si están corruptos: nunca
  repara acuerdos de dinero).
- Módulo puro `src/features/orders/installments.ts`: validación es-MX, reparto
  exacto en centavos, derivación de fechas, waterfall de cobertura, vista de
  lectura (`installmentPlanView`) y compuerta de entrega
  (`installmentDeliveryBlocked`). Sin estado, sin segundos acumuladores.
- Persistencia: ninguna colección nueva. El plan vive en el documento del
  pedido; los abonos siguen en `orders/{orderId}/payments` (#123). Sin reglas
  nuevas de Firestore (las rutas usadas ya existen: pedido, productos y
  subcolección de cobros).
- Sinatoria de `saveOrderWithStockTx`: parámetro final `paymentRecords`
  (registros de la sesión). Las transacciones de Firestore no admiten queries,
  así que las compuertas de entrega/conversión evalúan contra esa vista; los
  registros son solo-create, una vista desactualizada solo SUBESTIMA el
  recibido → la compuerta erra hacia bloquear, nunca hacia permitir. (Ventana
  residual: una devolución concurrente en milisegundos; documentada, aceptada.)

## Costo Firestore estimado (free tier: 50K lecturas / 20K escrituras por día)

| Operación | Lecturas | Escrituras |
|---|---|---|
| Primer abono (reserva) | ≤ 4 + P (cobro+pedido+heredado+P productos en tx; +2–4 por reglas `get`) | 2 + P (heredado 0–1, cobro, pedido, P productos) |
| Abono posterior / reintento | ≤ 3 (igual que #166) / 1 | 1 / 0 |
| Guardar pedido con plan (sin conversión/entrega) | igual que un pedido ordinario | igual |
| Guardar pedido con plan (conversión o entrega) | + N cobros de la sesión (ya leídos al abrir Cobros) | 0 extra |
| Abrir la hoja de cobros | 1 (regla) + N cobros | 0 |

P = productos distintos del pedido (típicamente 1–3). Con ~100 abonos/día de
los cuales ~20 primeros-abonos y P=2: ≈ 20×12 + 80×3 ≈ **480 lecturas** y
≈ 20×4 + 80×1 ≈ **160 escrituras** diarias (≈1% de la cuota gratuita). Sin
listeners nuevos: los cobros se leen solo al abrir la hoja del pedido; el
calendario se deriva en memoria.

## Validación

- Unitario (`npm run test`): centavos/residuo (Σ == total en 60 combinaciones),
  calendario (semanal/quincenal/mensual, ajuste de mes, bisiesto), validación
  de entradas, waterfall ($100 → saldo $1,700; +$500 → $1,200; recibos ≠
  cuotas), caso ilustrativo completo (5×$300 → $1,500/$300 sin entrega;
  $1,800 → entrega manual), devolución que des-cubre, aislamiento por
  pedido+tienda, retención de stock por cancelación, migración, formularios y
  UI. 492 pruebas en verde (+13 de #165 puro/UI).
- Emulador (CI, `npm run test:rules`): `installments.emulator.test.ts` —
  plan sin abonos no reserva y el ordinario sí; primer abono reserva UNA vez
  (reintento/doble clic/concurrencia); sin existencias aborta explícito sin
  stock negativo; cancelación no libera; entrega bloqueada con saldo y
  manual al liquidar; conversión con dinero no libera; tienda ajena bloqueada.
  Omiso localmente por la regla de no-emuladores del PO.

## Limitaciones conocidas (deuda explícita, no silenciosa)

- La compuerta de entrega en `saveOrderWithStockTx` evalúa contra los registros
  que pasa el llamador (ver arriba): en una sesión que nunca abrió Cobros puede
  bloquear una entrega ya liquidada en otro dispositivo; abrir la hoja refresca
  y desbloquea. Dirección conservadora.
- `delivering` de un pedido a plazos YA entregado que vuelve a entregarse
  (p. ej. entregado → listo → entregado) pasa por la compuerta otra vez —
  correcto: cada confirmación exige saldo cero.
- Quitar el plan no borra la reserva ni el historial: son evidencia.
- El PO decidirá (pendiente, reversible): abono bajo pedido sin existencias
  (hoy bloquea) y si la entrega con saldo debe permitirse alguna vez (hoy no).
