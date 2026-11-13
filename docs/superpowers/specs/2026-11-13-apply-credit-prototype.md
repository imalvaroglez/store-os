# Prototipo: applyCredit/releaseCredit — operación de confianza para el saldo a favor (#380)

Fecha: 2026-11-13 · Estado: **prototipo verificado en emulador** — el despliegue de la función y el cambio de reglas quedan pendientes de la revisión del PO.

## Problema

Las reglas de Firestore no pueden computar el superávit real de una clienta (requiere sumar `items`, inexpressible en CEL). El PR #403 —detenido por el PO— cerró la trazabilidad (pares firmados, respaldo, aislamiento, suma exacta) pero dejó documentado que un miembro puede fabricar un par de $300 cuando solo existen $100: subcobro real. El PO rechazó ese residual como cierre del #380.

Corrección de diseño (PO): el Admin SDK escribe por IAM y **no pasa por las reglas** — la protección final no es validar las escrituras admin, sino que **las reglas bloqueen toda escritura de cliente a los campos de crédito** y que la función sea la única vía, validando ella misma autenticidad, membresía, misma clienta y saldo real con datos frescos.

## Diseño del prototipo

### Callables (`functions/src/applyCredit.mjs`)

- **`applyCredit({ storeId, fromOrderId, toOrderId, amountCents, intentId })`**
  1. Autentica (`req.auth`); resuelve membresía desde `adminStores` (miembro/dueño, más la lista de correos de plataforma — mismo criterio que las reglas).
  2. UNA transacción admin: lee ambos pedidos frescos; verifica tienda, misma clienta, nadie cancelado.
  3. **Idempotencia primero**: si el ledger destino ya tiene `app_<intentId>` → `{ applied: false }` sin escribir.
  4. **El tope que las reglas no pueden expresar**: `creditAvailableCents(origen fresco) ≥ importe` y `pendingCents(destino fresco) ≥ importe`; si no, rechaza con el mensaje en español («El saldo a favor disponible es de X pesos…»).
  5. Escribe el par completo — espejo `consumption` en el origen + `application` en el destino + bump de `revision` en ambos — atómico. Sin fases: commit o throw; el reintento con el mismo `intentId` es no-op.

- **`releaseCredit({ storeId, orderId, intentId, capCents?, idPrefix? })`** — la vía para cancelaciones e incidencias: netByOrigin del ledger, tope por `capCents` (la obligación propia del evento de incidencia), tope por el espejo real de cada origen (deriva conservadora), entradas taggeadas `rel_<eventId>_` e idempotencia por intento (el reintento ve lo ya taggeado y no mueve nada).

### Puerto de matemáticas (`functions/src/creditMath.mjs`)

Las funciones son `.mjs` y no pueden importar el TS de la app. El puerto replica `creditAvailableCents`/`pendingCents`/`docReceivedCents`/incident money, y **`src/features/orders/creditMathPort.test.ts` (13 pruebas) lo bloquea a la fuente de verdad TS** en una matriz de fixtures (sobrepago, consumo parcial, depósito legado, incidencias con reembolso/reemplazo, campos corruptos): si divergen, la función no sale.

### Reglas (variante del prototipo)

`orders.update` añade: cualquier **cambio** a `creditAppliedCents`/`creditConsumedCents`/`creditLedger` desde el cliente SDK → denegado (los arrastres verbatim no son claves afectadas: los guardados ordinarios siguen pasando). El Admin SDK pasa por IAM. Esta es la protección final: la única vía es el callable.

### Guard de respaldo en la edición (`saveOrderWithStockTx`)

Una edición posterior del origen no puede invalidar el saldo que respalda otra venta: si `creditConsumedCents > 0`, el guardado exige que el superávit fresco tras la edición (recibido − total efectivo − reembolsos comprometidos) siga cubriendo el consumo espejado; si no, rechaza en español («…la edición dejaría ese saldo sin respaldo…»). Verificado en suite de emulador (edición que sube el total → rechazada y estado intacto; edición inofensiva → pasa).

## Evidencia (emulador, reproducible)

- **Demo end-to-end** `scripts/proto-applycredit.emulator.mjs` bajo auth+firestore+functions: **8/8**
  - P1: $300 sobre $100 disponibles → rechazado con mensaje y estado intacto.
  - P2: dos `applyCredit` concurrentes → exactamente el disponible comprometido (uno cumple, uno rechaza; serialización de transacciones).
  - P3: devolución parcial ($50 de $100) exacta; su reintento conserva el resultado (0 extra).
  - P4: reintento de apply con el mismo `intentId` → sin duplicados en ningún lado.
  - P5: escritura directa del cliente a crédito → PERMISSION_DENIED.
  - P6: el consumo sigue respaldado (invariante).
- **Suite de reglas+guard** `protoCreditRules.emulator.test.ts` (en `test:rules`): **4/4** — bloqueo total por reglas (los tres campos), guardado ordinario con crédito verbatim pasa, edición-invalidante rechazada en español con estado intacto, edición inofensiva pasa.
- **Equivalencia del puerto**: 13/13. Unitarias completas 2,113 ✓, typecheck ✓, build ✓.

## Plan de transición para PWA viejas

- **Fase 0 (este PR, sin desplegar):** solo el prototipo en rama. Producción intacta.
- **Fase 1 — despliegue de la función y adopción del cliente:** desplegar `applyCredit`/`releaseCredit` a dev y luego a producción; el cliente cambia la compensación automática, la cancelación y la restitución de incidencias para llamar a los callables (los flujos ya construyen ids de intento estables). **Las reglas siguen permitiendo la escritura directa** durante esta ventana: las PWA viejas siguen compensando como hoy (sin degradación). Telemetría mínima: el ledger distingue entradas escritas por la función (`by` = uid, mismas firmas) — con un contador de compensaciones por versión en la nota de release basta.
- **Fase 2 — cierre de reglas (2+ semanas después, o cuando la telemetría muestre cero escrituras de crédito desde builds viejos):** desplegar la variante de reglas que bloquea al cliente. Una PWA vieja que intente compensar recibirá PERMISSION_DENIED fail-closed → el efecto de compensación reintenta y muestra el banner de sincronización pidiendo recargar la app; al recargar, la PWA actualiza y usa los callables. Ventana de molestia acotada y autorreparable; ninguna pérdida de datos (el dinero no se toca si la escritura se rechaza).
- **Rollback:** revertir las reglas re-habilita la vía directa (la función sigue siendo la vía de los builds nuevos); no hay migración de datos — el formato del ledger es idéntico al que #403 ya definió.

## Consumo (restricción de cero costos)

- **Cloud Functions**: 2M invocaciones/mes gratis. Las compensaciones corren ~1 vez por guardado de pedido con saldo pendiente; Olivia opera decenas/mes → margen >4 órdenes de magnitud. Config idéntica a `importPurchasePdf`: `retry: false`, `minInstances: 0`, `maxInstances: 3`, 256MiB, 30s.
- **Firestore**: cada llamada hace las mismas lecturas/escrituras que la transacción actual del cliente (2-4 reads + 2-4 writes) — consumo neutro.
- Sin servicios nuevos; nada fuera del free tier.

## Pendiente (decisión del PO)

1. Aprobar el diseño (callables + cierre de reglas en fase 2) como cierre del #380.
2. La base de #403 (pares espejo, ledger, revisiones, suite de 275+ pruebas de emulador) es compatible y reutilizable: si se aprueba, #403 se integra primero (su disciplina de evidencia), luego este prototipo cambia el escritor; o se fusionan en una sola entrega — recomendado fusionar para que el cierre de reglas llegue con toda la disciplina ya probada.
