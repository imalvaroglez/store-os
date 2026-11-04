# Base de cobros por pedido (#123) — reglas de dinero

Fecha: 2026-11-02 · Rama: `codex/issue-123-payments` · Refs #123 (define también #165)

Propuestas implementadas el 2 de noviembre, registradas en #123/#165.
La autonomía de implementación no acredita aprobación de reglas comerciales;
el ledger #171 mantiene sus condiciones pendientes.

## Reglas propuestas, pendientes de aprobación

1. **Anticipo heredado** (revisada por el PO, 2026-11-03). El `deposit`
   previo a los registros por cobro se materializa UNA vez como registro
   acumulado con la **fecha y método que captura la operadora** — estimados
   cuando no los recuerda; ya NO se registran como "desconocidos". Mientras
   no exista ningún registro, el resumen lo cuenta como recibido pendiente de
   materializar; el primer cobro exige esos datos y lo registra en la misma
   transacción (id determinista `inherited_deposit`, sin doble conteo). Un
   ajuste como primer registro NO materializa: solo un cobro real lo hace.
   (`method: "unknown"` queda reservado a los ajustes internos, que no son
   recepciones de dinero.)
2. **Fecha real.** Cada cobro guarda la fecha de recepción que captura la
   operadora (por defecto hoy), independiente del estado logístico. `createdAt`
   conserva el momento de registro como evidencia adicional.
3. **Correcciones y devoluciones.** Nunca se edita ni borra un cobro: un ajuste
   es un registro nuevo con monto con signo (negativo = devolución) y **nota
   obligatoria**. Recibido y saldo siempre se recalculan desde los registros.
4. **Cambio de total.** Los cobros se conservan intactos y el saldo se
   recalcula contra el total vigente; un saldo negativo se muestra como "A
   favor". El cambio del total queda evidenciado en la edición del pedido.

## Modelo

- Tipo `OrderPayment` (`src/types/index.ts`): `id`, `orderId`, `storeId`,
  `date?` (YYYY-MM-DD; ausente = desconocida), `method`
  (`cash|transfer|unknown`; `unknown` solo para el heredado), `kind`
  (`payment|adjustment`), `amount` (unidades decimales con signo), `note?`,
  `createdAt`, `createdBy`.
- Módulo puro `src/features/orders/payments.ts`: constructores validados
  (toda coerción vía `parseAmount`; centavos exactos con residuo explícito a
  través de `orderAmountCents` — #165 aprovechará la misma base para dividir),
  suma de recibido, saldo firmado, aislamiento por `orderId`+`storeId`.
- Persistencia: subcolección `orders/{orderId}/payments` en Firestore. El
  registro es idempotente: id estable por intento del usuario + verificación
  previa dentro de la misma transacción; el reintento no escribe.
- Reglas (`firestore.rules`): alcance por tienda derivado del pedido padre
  (`canOperateStore` sobre `get(orders/{orderId})`); `create` exige
  `orderId == {orderId}` y coherencia de `storeId`; `update`/`delete` denegados
  para todos (evidencia inmutable, incl. super_admin).
- UI mínima: hoja "Cobros" en la tarjeta del pedido (`OrderPaymentsSheet`):
  total/recibido/saldo, aviso de heredado, lista cronológica, formulario de
  cobro (monto/método/fecha) y formulario de ajuste firmado. Sin sesión, el
  registro falla con error explícito. `OrderForm` queda intacto.

## Costo Firestore estimado por operación (free tier: 50K lecturas / 20K escrituras por día)

| Operación | Lecturas | Escrituras |
|---|---|---|
| Registrar cobro (primera vez, con heredado) | ≤ 4 (pago + pedido + heredado en tx, + 1–2 por reglas `get`) | 2 (heredado + cobro) |
| Registrar cobro (sin heredado pendiente) | ≤ 3 | 1 |
| Reintento del mismo cobro | 1 | 0 |
| Abrir la hoja de cobros | 1 (regla) + N cobros | 0 |

Con ~100 cobros/día: ≈ 400 lecturas y ≤ 200 escrituras diarias (≪ 1% de la
cuota gratuita). Sin listeners globales: los cobros se leen solo al abrir la
hoja del pedido.

## Validación

- Unitario (`npm run test`): registro, caso $1,010 + $200 = $1,210, saldo
  $400/$1,000 → $600, cambio de total, ajuste sin borrar evidencia, heredado
  sin doble conteo, aislamiento entre tiendas, reintento con el mismo id, render
  de la UI. 443 pruebas en verde.
- Reglas: `src/app/firebase/orderPayments.emulator.test.ts` (idempotencia,
  materialización única, tienda ajena bloqueada, inmutabilidad, privacidad)
  corre en CI (`npm run test:rules`). La validación LOCAL de reglas fue
  omitida por la regla de no-emuladores del PO; `rules-and-e2e` la ejecuta.

## Limitaciones conocidas (deuda explícita, no silenciosa)

- El botón heredado "Cobrar" de la tarjeta sigue escribiendo `deposit` de un
  golpe (comportamiento previo conservado para no romper flujos existentes);
  retirarlo/deprecarlo es trabajo posterior una vez integrada la base.
- #174 impide borrar pedidos con cobros o reservas y protege sus campos de
  evidencia; el historial no se pierde ni se elimina por inferencia.
- `OrderForm` sigue permitiendo editar `deposit`; una vez materializado el
  heredado, ese campo queda congelado como dato heredado (#165 lo retoma).


## Integridad del acumulado y comprobantes nuevos (#171, corrección incremental)

El registro transaccional añade `lastPaymentId` al padre y `amountCents` al
comprobante nuevo (también al heredado). `amount` conserva su precisión original.
Las reglas validan las dos direcciones: cambiar acumulado/materialización/enlace
requiere un comprobante ordinario NUEVO en la misma transacción, con suma exacta;
crear comprobantes requiere que el padre los incorpore. El heredado se añade solo
al materializar el anticipo existente, una vez y con su importe original. Un lote
no puede introducir un segundo comprobante normal que quede fuera de la suma.
El enlace apunta a un registro que antes no existía, por lo que un replay no
vuelve a sumarlo. Crear un pedido con acumulado/enlace/materialización se rechaza.
Guardar el formulario conserva el enlace canónico; los lectores anteriores no
necesitan el campo para mostrar los registros existentes.

Para comprobar el redondeo simétrico exacto, las reglas convierten el importe
numérico a su texto decimal canónico (`string(amount)`), separan coeficiente y
exponente y extraen los dígitos de centavos y el primer dígito descartado. Es la
misma regla decimal de `orderAmountCents`, aplicada sin multiplicación binaria ni
tolerancias. Se conserva `amount` original. La alternativa por intervalos de
medio centavo se descartó: una comparación diferencial de 9,000 valores contra
el helper encontró 48 discrepancias cerca de 9e12. No se reduce el rango admitido
para ocultarlas. La matriz de emulador incluye esos casos grandes, notación
científica, valores junto al límite y simetría negativa.
La suma acumulada también exige enteros seguros; ante datos corruptos o desborde
se aborta sin reemplazarlos por cero ni cambiar el saldo.

Comprobantes antiguos permanecen legibles. Un pedido con acumulado anterior pero
sin enlace incorpora su siguiente comprobante sin reescribir históricos. Esta
garantía valida las transiciones nuevas; no certifica que datos anteriores
manipulados ya estuvieran conciliados. Cualquier conciliación de datos existentes
requiere evidencia y autorización propias; este cambio no migra ni toca datos.
App y reglas deben liberarse juntas tras aprobación humana: versiones anteriores
del cliente que no envíen el enlace/centavos recibirán rechazo explícito al cobrar,
no éxito aparente. No se ejecuta liberación desde este trabajo.

Estimación conservadora actualizada (sustituye para este cambio la tabla original):
se presupuestan hasta 48+5P lecturas por intento y 3+P escrituras confirmadas si
se reserva. La cota cuenta por separado autorización de cada lectura del cliente,
hasta 20 accesos del lote de escritura en reglas y una lectura excepcional del
padre con su autorización, sin descontar caché entre solicitudes. P es el número
de productos leídos en la primera reserva; después P=0.
El registro limita el total a 5 ejecuciones transaccionales, compartiendo ese
presupuesto entre reintentos del SDK y una reserva concurrente. Solo se reintenta
un rechazo de permiso si una lectura del servidor confirma que cambió el pedido
leído (revisión, dinero, enlace o marca). Un rechazo real no se oculta.
Para 100 cobros/día sin reserva y sin reintentos: hasta 4,800 lecturas/300
escrituras (9.6%/1.5% de cuotas diarias). Para 100 primeras reservas de P=2 con
el extremo de 5 intentos: hasta 29,000 lecturas/500 escrituras (58%/2.5%), dentro
de cuotas. Es presupuesto del cambio a ese volumen, no certificación del consumo
total de la app. La prueba de 50 productos valida el límite técnico de accesos;
si ese tamaño se usa habitualmente, se recalcula volumen y presupuesto conjunto
antes de ampliarlo. No se añaden listeners, servicios ni lecturas por render.

Pruebas: suma segura (dos regresiones vistas en rojo antes de corregir), reglas
con SDK directo contra inflación/reducción/replay, registros huérfanos y lotes
con suma incorrecta, redondeo positivo/negativo y subcentavos heredados, anticipo
fraccionario y falso heredado, concurrencia y guardado con enlace inventado.
Incluye un primer abono con reserva de 50 productos para validar los límites de
accesos de reglas. Emuladores solo en CI, conforme al acuerdo del proyecto.

Referencia técnica: [operaciones atómicas con getAfter](https://firebase.google.com/docs/firestore/security/rules-conditions#access_other_documents).


El acumulado se escribe con `increment(savedCents)` y evidencia en la misma
transacción, de modo que las reglas evalúen el incremento contra el padre
canónico aun bajo contención. La suficiencia/precisión se comprueba antes de
escribir y las reglas comprueban el resultado final. La marca inmutable de
primera reserva y el heredado siguen requiriendo lectura canónica: si compiten
dos primeros cobros, un permiso rechazado por evidencia ya cambiada se reintenta
solo tras comprobar esa carrera en el servidor, dentro del mismo límite total.
Pruebas de dos primeros abonos y de dos materializaciones concurrentes conservan
ambos cobros, una sola reserva y un solo anticipo heredado.


## Saldo confirmado en la interfaz y reintentos (#171, cambio 3)

El servicio devuelve comprobantes y el pedido canónico de la transacción, incluso
si reconoce un intento ya registrado. El cliente no suma otra vez esos importes.
`paymentsRevision` aumenta una vez por registro nuevo (no por reintento), queda
protegida por reglas junto con el acumulado y permite descartar respuestas viejas
sin comparar importes: un ajuste negativo válido también debe aplicarse. Un
intento estable reutilizado con importe/método/fecha de recepción/motivo distintos se rechaza
sin modificar la evidencia ni aparentar éxito.

El proveedor reconcilia versiones de negocio y de cobros de forma independiente:
conserva notas/cantidades más recientes y no revierte dinero por una respuesta o
snapshot antiguo. No reinserta pedidos ausentes ni mezcla IDs de tiendas. Estas
garantías se aplican a respuestas de cobros y snapshots cloud; no amplían la rama
administrativa local heredada. La caché de comprobantes se etiqueta por UID y generación y se filtra desde el
primer render de otra cuenta, además de limpiarse; respuestas de un UID anterior
o tras desmontar el proveedor se descartan. Una hoja cerrada o de otro dueño no
anuncia éxitos tardíos ni borra la captura de otra vista.
Los guards generales de hidratación/acceso de #96/#111 siguen siendo una
integración necesaria; esta corrección no sustituye esa revisión de fiabilidad.

La carga de detalle usa servidor: lee la versión del padre, los comprobantes y
el padre otra vez. Si la versión cambió, rechaza el detalle intercalado y permite
volver a cargar; no lo presenta como una lista completa. La hoja muestra estado
de carga/error y bloquea el registro hasta recuperarse, conservando la captura.
La versión se refresca solo con la hoja abierta. El saldo viene del acumulado
canónico, no de una lista aún vacía o incompleta en la sesión.

Tarjeta ordinaria, listado e Inicio usan el recibido canónico cuando existen
comprobantes. Los pedidos sin comprobantes conservan el anticipo heredado. En
pedidos con cobros, «Cobrar» abre la hoja: no cambia solo `deposit` ni anuncia
«Pedido cobrado» sin comprobante. Saldos a favor se muestran en la tarjeta/hoja;
los agregados de deuda mantienen saldo no negativo por pedido y no compensan
saldos de otras ventas por inferencia.

Validación proporcional: regresiones vistas en rojo de duplicación $400→$800,
respuesta de cuenta anterior, resumen sin registros en sesión y vistas ordinarias
que ignoraban cobros. Pruebas del proveedor para respuestas invertidas/ajustes,
ediciones recientes, pedido removido y cambio de sesión; hoja con carga/error y
recuperación; reglas/servicio de versión canónica y reintento sin escrituras;
recorrido Playwright abono→recarga→ajuste en móvil/escritorio. Emuladores en CI.

Consumo: mismas escrituras por cobro; el replay lee pedido+comprobante, sin
escribir. Abrir/refrescar la hoja lee N comprobantes y dos padres más sus reglas.
Para 100 cobros y 200 cargas/refrescos con N≈20 se presupuesta hasta 8,000 lecturas
adicionales, con autorizaciones y margen. Sumado al extremo habitual de 29,000
lecturas/500 escrituras de la corrección anterior para P=2 y cinco intentos,
permanece bajo las cuotas gratuitas (hasta 37,000/500 al volumen supuesto). Un
historial o volumen mayor requiere revisar presupuesto conjunto. Sin listeners
nuevos, servicios pagados ni consultas por render/línea. App/reglas del mismo
commit se promueven juntas solo tras aprobación humana.
