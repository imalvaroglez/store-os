# Plan de pagos configurable por pedido (#165) — reglas de dinero y stock

Fecha: 2026-11-02 · Rama: `codex/issue-165-installments` (apilada sobre `codex/issue-123-payments`, PR #166) · Refs #165 (define #123)

> **Revisión #168 (2026-11-02):** la revisión independiente encontró que la
> compuerta de conversión fallaba en la dirección inversa a la documentada
> (una sesión sin cobros cargados NO marcaba la reserva y liberaba stock
> respaldado por dinero) y que quitar el plan eludía la compuerta de entrega.
> Corregido moviendo la verdad del dinero recibido al DOCUMENTO del pedido
> (regla 9, `paymentsReceivedCents`); la frase "una vista desactualizada solo
> subestima el recibido" era FALSA y se retiró. Detalle por hallazgo (F1–F7)
> en el PR #168.

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
3. **Abonos = los mismos cobros de #123.** No existe una segunda FUENTE de
   dinero: la hoja de cobros reconstruye recibido/saldo con `paymentSummary`
   sobre los registros; las compuertas, la tarjeta y el ticket leen el
   acumulado transaccional del documento (regla 9), que es esa misma Σ
   mantenida por la transacción de cada cobro. Un
   abono cubre primero la cuota con vencimiento más próximo y el sobrante pasa
   a la siguiente (waterfall sobre Σ recibido); el número de recibos ≠ cuotas
   cumplidas. El atraso se muestra informativo (`Atrasada`), sin penalización:
   no existen intereses ni cargos en el modelo.
4. **Reserva al primer abono, una sola vez.** Un plan sin abonos NO aparta
   piezas (extensión del modelo de contribución de `inventory.ts`). El PRIMER
   abono positivo confirmado (`kind: "payment"`, monto > 0) reserva las
   cantidades del pedido en la MISMA transacción que registra el cobro:
   stock canónico re-leído, marca `installmentsReservedAt` + `revision`
   escritas atómicamente (junto con el acumulado de la regla 9, en el mismo
   update del pedido). Reintentos (mismo id), doble clic, abonos posteriores
   y concurrencia (reintento de transacción) nunca vuelven a reservar; un
   editor con estado viejo aborta con `StaleOrderError` en lugar de liberar en
   silencio. Pedidos ordinarios conservan su reserva temprana.
5. **Sin existencias al primer abono** → `InsufficientStockError`: el abono NO
   se registra, sin stock negativo ni reserva silenciosa. *Pendiente de PO —
   reversible:* si se permite registrar el abono sin reserva (bajo pedido) o se
   mantiene el bloqueo; hoy bloquea.
6. **Entrega al liquidar, confirmación manual.** La transición hacia
   `delivered` se rechaza con `DeliveryWithBalanceError` en
   `saveOrderWithStockTx` (camino de mutación, no solo botones ocultos) cuando
   el pedido tiene plan **O** dinero recibido según el documento
   (`paymentsReceivedCents` + anticipo heredado pendiente) y ese dinero no
   cubre el total. Quitar el plan con saldo NO habilita entregar en el mismo
   guardado (#168 F1). Liquidar HABILITA entregar; no marca nada
   automáticamente. Pedidos ordinarios sin cobros ni plan conservan su
   comportamiento.
7. **Cancelación no infiere.** Cancelar un pedido a plazos YA reservado NO
   libera stock ni devuelve dinero: las piezas siguen apartadas hasta que la
   operadora lo resuelva explícitamente (ajuste de inventario; devolución =
   ajuste con signo y nota de #123). Un plan sin abonos cancelado no tiene
   nada que liberar.
8. **Edición post-cobro con evidencia.** Cambiar o quitar el plan conserva el
   acuerdo anterior verbatim en `installmentsHistory` (nunca se reescribe).
   Convertir en plan un pedido que ya recibió dinero — según el ACUMULADO del
   documento, no según los cobros cargados en la sesión (#168 F2) — marca la
   reserva de inmediato (sin delta de stock: un pedido abierto ordinario ya
   tenía las piezas). Quitar el plan de un pedido reservado no libera las
   piezas.
9. **La verdad del dinero recibido vive en el documento del pedido (#168).**
   `paymentsReceivedCents` acumula Σ centavos con signo de los cobros del
   pedido; lo mantiene `registerOrderPaymentTx` en la MISMA transacción que
   escribe cada cobro (idempotente igual que el registro: un reintento
   reconocido no vuelve a sumar). El anticipo heredado entra al acumulado al
   materializarse y `inheritedDepositMaterialized` evita contarlo dos veces.
   Compuertas (conversión/entrega), tarjeta y ticket leen este acumulado; los
   registros de la sesión solo alimentan el desglose de la hoja Cobros. Un
   guardado de pedido arrastra el acumulado del documento verbatim (un
   save de documento completo nunca borra el dinero de un cobro concurrente).

## Modelo

- `Order.installments?: { count, frequency, firstDueDate, agreedAt?, agreedBy? }`
  + `installmentsReservedAt?` (marca idempotente) + `installmentsHistory?`
  + `paymentsReceivedCents?` (acumulado transaccional de dinero recibido,
  regla 9) + `inheritedDepositMaterialized?`. `migrateOrder` los pasa verbatim
  (o los descarta si están corruptos: nunca repara acuerdos de dinero).
- Módulo puro `src/features/orders/installments.ts`: validación es-MX, reparto
  exacto en centavos, derivación de fechas, waterfall de cobertura, vista de
  lectura (`installmentPlanView`, dinero del documento) y compuerta de entrega
  (`deliveryWithBalanceBlocked`: plan **o** dinero recibido, total > recibido).
  Sin estado, sin segunda fuente de dinero.
- Persistencia: ninguna colección nueva. El plan y el acumulado viven en el
  documento del pedido; los abonos siguen en `orders/{orderId}/payments`
  (#123). Las reglas de la subcolección validan CONTENIDO en create
  (`amount` número ≤ 9e12 en valor absoluto y ≠ 0; `method` en
  cash/transfer/unknown; `kind` en payment/adjustment; cobros > 0; ajustes con
  nota) — un SDK crudo no puede inyectar evidencia basura (#168 F5). Un monto
  almacenado fuera de precisión segura se trata como corrupto en el render
  (excluido con aviso), nunca como RangeError.
- Firma de `saveOrderWithStockTx`: SIN vista de sesión. Las transacciones de
  Firestore no admiten queries, así que las compuertas de entrega/conversión
  evalúan el ACUMULADO del documento leído en la propia transacción
  (`paymentsReceivedCents` + anticipo heredado pendiente). La revisión
  independiente (#168) demostró que la vista de sesión fallaba en la dirección
  INVERSA a la aquí documentada antes: una conversión desde una sesión sin
  cobros cargados NO marcaba la reserva y liberaba stock respaldado por
  dinero. Ese hueco ya no existe: el documento no miente sobre el dinero.
- **Sin migración:** la colección `payments` nace en esta tanda (#166+#168);
  no existen datos previos fuera de dev/seed de prueba, y los seeds que
  escriban cobros directos deben mantener `paymentsReceivedCents` en el
  documento del pedido (regla 9) o el pedido se lee con $0 recibido.

## Costo Firestore estimado (free tier: 50K lecturas / 20K escrituras por día)

| Operación | Lecturas | Escrituras |
|---|---|---|
| Primer abono (reserva) | ≤ 4 + P (cobro+pedido+heredado+P productos en tx; +2–4 por reglas `get`) | 2 + P (heredado 0–1, cobro, pedido —reserva+acumulado en UN update—, P productos) |
| Abono posterior / reintento | ≤ 3 (igual que #166) / 1 | 2 / 0 (cobro + update del acumulado en el doc del pedido) |
| Guardar pedido con plan (sin conversión/entrega) | igual que un pedido ordinario | igual |
| Guardar pedido con plan (conversión o entrega) | igual que un pedido ordinario (el dinero ya está en el doc; la sesión ya no aporta nada) | 0 extra |
| Abrir la hoja de cobros | 1 (regla) + N cobros | 0 |

P = productos distintos del pedido (típicamente 1–3). Con ~100 abonos/día de
los cuales ~20 primeros-abonos y P=2: ≈ 20×12 + 80×3 ≈ **480 lecturas** y
≈ 20×4 + 80×2 ≈ **240 escrituras** diarias (≈1.2% de la cuota gratuita de
20K; el +1 por cobro es el acumulado en el documento del pedido, regla 9).
Sin listeners nuevos: los cobros se leen solo al abrir la hoja del pedido; el
calendario y la tarjeta se derivan en memoria desde el documento.

## Validación

- Unitario (`npm run test`): centavos/residuo (Σ == total en 60 combinaciones),
  calendario (semanal/quincenal/mensual, ajuste de mes, bisiesto), validación
  de entradas, waterfall ($100 → saldo $1,700; +$500 → $1,200; recibos ≠
  cuotas), caso ilustrativo completo (5×$300 → $1,500/$300 sin entrega;
  $1,800 → entrega manual), devolución que des-cubre, acumulado del documento
  (`docReceivedCents`/`orderMoneyAfterPayments`, anticipo heredado sin doble
  conteo), compuerta `deliveryWithBalanceBlocked` (plan **o** dinero; quitar
  plan con saldo bloquea), tarjeta con acumulado tras recargar (#168 F3),
  ticket con cobros (F4), monto fuera de precisión tratado como corrupto
  (F5), sanitizador a 2 decimales (F6), formularios y UI.
- Emulador (CI, `npm run test:rules`): `installments.emulator.test.ts` —
  plan sin abonos no reserva y el ordinario sí; primer abono reserva UNA vez
  (reintento/doble clic/concurrencia) y alimenta el acumulado; sin existencias
  aborta explícito sin stock negativo; cancelación no libera; entrega de un
  plan liquidado desde una sesión SIN registros (#168: el doc es la verdad);
  quitar-plan→entregar con saldo se bloquea y liquida habilita (F1);
  conversión con dinero recibido marca y no libera, con y sin registros en
  sesión, incluido el caso solo-anticipo (F2); tienda ajena bloqueada.
  `orderPayments.emulator.test.ts` — reglas de contenido del create (F5).
  Omiso localmente por la regla de no-emuladores del PO.

## Limitaciones conocidas (deuda explícita, no silenciosa)

- El acumulado viaja en el documento del pedido y las reglas de `orders`
  permiten a un miembro reescribirlo con un SDK crudo — misma confianza que
  editar totales o anticipo (el modelo no defiende una tienda de su propia
  operadora); el camino de la app siempre lo reconstruye desde el documento.
- Sembrar cobros directo en la subcolección (scripts de dev) sin mantener
  `paymentsReceivedCents` produce un pedido que se lee con $0 recibido: estado
  no soportado (ver "Sin migración").
- `delivering` de un pedido a plazos YA entregado que vuelve a entregarse
  (p. ej. entregado → listo → entregado) pasa por la compuerta otra vez —
  correcto: cada confirmación exige saldo cero.
- Quitar el plan no borra la reserva ni el historial: son evidencia.
- Condiciones abiertas de la revisión #168 (fuera del alcance de estas
  correcciones, registradas en #171): (C2) borrar un pedido reservado con
  `deleteOrderWithStockTx` deja las piezas apartadas sin pedido que las
  referencie (latente: sin caller UI); (C3) las piezas retenidas por cuotas no
  aparecen en "Comprometido"; (C4) editar un pedido reservado agregando líneas
  puede dejar stock negativo (la validación de suficiencia solo existe al
  primer abono).
- El PO decidirá (pendiente, reversible): abono bajo pedido sin existencias
  (hoy bloquea) y si la entrega con saldo debe permitirse alguna vez (hoy no).
