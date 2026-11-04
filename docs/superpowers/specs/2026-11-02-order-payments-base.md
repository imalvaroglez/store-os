# Base de cobros por pedido (#123) — reglas de dinero

Fecha: 2026-11-02 · Rama: `codex/issue-123-payments` · Refs #123 (define también #165)

Decisiones adoptadas por autonomía del PO (2026-11-02, "continúa sin pausa") —
reversibles; registradas como comentarios en #123 y #165.

## Reglas adoptadas

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
- Borrar un pedido deja huérfanos sus documentos de cobro: son ilegibles (la
  regla depende del pedido padre) y de tamaño despreciable, pero persisten.
- `OrderForm` sigue permitiendo editar `deposit`; una vez materializado el
  heredado, ese campo queda congelado como dato heredado (#165 lo retoma).
