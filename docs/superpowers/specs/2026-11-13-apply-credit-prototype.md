# Prototipo: applyCredit/releaseCredit — operación de confianza para el saldo a favor (#380)

Fecha: 2026-11-13 · Actualizada 2026-11-16 · Estado: **diseño aprobado por el PO (15-nov) e implementado en rama** — el cliente usa los callables, las reglas cierran la escritura directa y las suites cubren la vía nueva. Pendiente: revisión independiente, CI y el orden de liberación de abajo.

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
- **Suite callable** `customerCredit.emulator.test.ts` reescrita a la vía nueva (auth+firestore+functions, en `test:rules`): **14/14** — par atómico, idempotencia, mensaje de replan (contrato de StoreProvider), concurrencia exacta, guards de tienda/clienta/cancelado, callable inaccesible para quien no es miembro, restitución por cancelación, F1/F2 de revisiones previas, confirmación de incidencia con restitución, autocuración y faltantes audibles (origen ausente y espejo inconsistente — sucesores r4).
- **Suite de borrado** `deleteCredit.emulator.test.ts` (misma vía): **6/6**.
- **Escenarios r4 de incidencias** migrados a la suite callable (la sesión firestore-only no arranca functions); contrato nuevo documentado arriba.
- **Equivalencia del puerto**: 13/13. Unitarias completas 2,342 ✓, typecheck ✓, build ✓, `test:rules` completo (22 suites) ✓, `e2e:firebase` (96 + 5) ✓ — la sesión sin functions confirma que ningún flujo de app toca crédito por el callable.

## Adopción del cliente (implementada, 16-nov)

Los TRES flujos que movían saldo escriben ahora por los callables; las firmas
públicas no cambian (`applyCustomerCreditTx` / `releaseCustomerCreditTx`):

- **Compensación automática** (`StoreProvider` → `applyCustomerCreditTx`):
  el `entry.id` viaja como `intentId`; el callable estampa `at`/`by` con la
  identidad autenticada. Los rechazos de tope del callable («El saldo a favor
  disponible es de X pesos…») se traducen al histórico «cambió mientras se
  aplicaba» — el contrato que `StoreProvider` traga como concurrencia
  esperada; el resto de mensajes conserva su texto y superficia.
- **Cancelación / borrado** (`releaseCustomerCreditTx`): el motivo
  (`cancellation` exige doc cancelado, leído fresco antes de llamar;
  `deletion` no) fija `intentId` estable (`<reason>_<orderId>`); la
  idempotencia real es el neto del ledger, como antes.
- **Incidencias** (`applyIncidentEventTx`, evento `confirmed`): el evento se
  confirma en su transacción (incidencias + inventario) y la restitución
  corre inmediatamente después con `releaseCredit({ intentId: event.id,
  capCents: obligación reconciliada, idPrefix: "rel_" })`. **Contrato r4
  evolucionado:** el aborto pre-commit de un origen ausente/inconsistente
  pasa a ser (a) confirmación cometida + (b) error explícito «solo se
  restituyeron X de Y pesos…» + (c) autocuración: re-registrar la misma
  confirmación detecta el `rel_` faltante y completa la restitución. El
  dinero nunca se mueve a ciegas: la restitución corta es visible y el reintento
  es idempotente por evento.

**Plan de liberación por entorno (AUTOMATIZADO en CI).** El job
`deploy-functions` publica y VERIFICA los callables antes de que
`deploy-rules` endurezca nada, en cada entorno: push a main → funciones a
`store-os-dev` + sondeo → reglas a dev; dispatch de release con su guard →
funciones a `store-os-f7cf8` + sondeo → reglas a producción → app. El release
guard (versión+notas) vive ahora en `deploy-functions` — es la PRIMERA
mutación productiva del release, y el choke point se movió con ella. El
sondeo post-deploy exige que cada callable exista y rechace una llamada sin
sesión (401/403/400 con cuerpo de error Firebase; 404 o 5xx falla cerrado).
Ya no hay paso manual de functions: la coordinación con liberación se reduce
a despachar la ventana con el orden del workflow. Rollback: revert en main →
el mismo job re-publica las functions del estado anterior y las reglas
revertidas re-habilitan la vía directa (sin migración; ledger idéntico).

**Validación de disponibilidad:** réplica local de la secuencia completa del
pipeline sobre emuladores (2026-11-17): (1) funciones sirviendo; (2) el
sondeo del job en verde para ambos callables; (3) reglas del repo endurecidas
con funciones disponibles → suite callable 14/14; (4) rollback con reglas
previas → la escritura directa de cliente vuelve a pasar. La compatibilidad
de transición (PWA vieja bajo reglas cerradas: denegación → banner con
reintento → recarga) está cubierta por la spec fase 2 y por P5 del demo.## Guion de verificación para la revisora (fallos parciales, reintentos, recuperación de saldo)

Todo reproduce desde la raíz del repo con emuladores; el SHA de esta entrega
viaja en el PR.

1. **Suite callable completa** (reglas cerradas + callables + auth real):
   `firebase emulators:exec --project store-os-dev --config firebase.emulator.json --only auth,firestore,functions "npx vitest run --no-file-parallelism src/app/firebase/customerCredit.emulator.test.ts"` — cubre: par atómico, idempotencia por intento, **fallo de plan vencido** (rechaza y estado intacto), **concurrencia** (dos apply simultáneos comprometen exactamente el disponible), no-miembro rechazado, restitución por cancelación, **incidencia con restitución**, **autocuración** (evento confirmado cuya restitución no aterrizó se completa al re-registrar) y **faltante audible** (origen ausente / espejo inconsistido → error «solo se restituyeron…», incidente confirmado y crédito intacto).
2. **Borrado con crédito** (misma vía): sustituir el archivo por
   `src/app/firebase/deleteCredit.emulator.test.ts`.
3. **Demo end-to-end de los PO-proofs**:
   `firebase emulators:exec --project store-os-dev --config firebase.emulator.json --only auth,firestore,functions "node scripts/proto-applycredit.emulator.mjs"` — $300 sobre $100 rechazado, devolución parcial exacta y su reintento sin duplicar, escritura directa denegada.
4. **Guard de respaldo en la edición**: `src/app/firebase/protoCreditRules.emulator.test.ts` (en `npm run test:rules`) — la edición que dejaría el saldo sin respaldo se rechaza en español; la inofensiva pasa.

## Plan de transición para PWA viejas (conciliado con el PR real)

Este PR **ya no libera una fase de reglas permisivas**: llega con las reglas
cerradas y con el paso `deploy-functions` de CI publicando y verificando los
callables ANTES de `deploy-rules` en cada entorno (ver arriba). La transición
que queda es sólo la ventana de PWA cacheada: un build viejo que intente
escribir crédito directo recibe denegación fail-closed → el banner de
sincronización con reintento → al recargar, la PWA actualiza y usa los
callables. Sin pérdida de datos (el dinero no se toca si la escritura se
rechaza) y con reversión documentada (revertir reglas re-habilita la vía
directa). Las fases originales de dos etapas quedan como histórico del diseño;
el estado vigente es éste.

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
