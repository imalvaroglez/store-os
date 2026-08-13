# Backlog

Lista viva de capacidades candidatas para Store OS. Cada entrada describe el
**problema** (qué necesita la usuaria), el **alcance propuesto** (no es spec
aprobado — es un punto de partida), las **decisiones pendientes** que hay que
cerrar antes de spec, y los **datos disponibles vs faltantes**.

El flujo para mover una entrada a "en curso" es el **Product Loop** (LOOPS.md
§2): humano decide capacidad → spec aprobado → harness/agent implementa → QA →
deploy. Nada aquí está comprometido hasta que hay spec firmado.

Estado: `💡 idea` · `🔬 refining` · `📋 specced` · `🚧 in progress` · `✅ done` ·
`❄️ frozen`

## Índice (por prioridad)

> **Cómo leer este índice:** clasificado por **readiness para el workflow de
> delivery** (sub-agentes), no solo por prioridad. Un item `🟢 ready` tiene su
> objetivo acotado y todas las decisiones cerradas — puede entrar al FSM tal
> cual. Un item `🟡 needs-decision` tiene decisiones que solo el PO puede cerrar;
> hasta entonces el harness las inventaría. `🔴 needs-spec` requiere escritura
> de spec antes de tocar código. La prioridad de negocio va en cada entrada.

### 🟢 Ready para el workflow (objetivo acotado, decisiones cerradas)
- **Deuda: "Un refresh debería funcionar como un refresh"** — ready, **no
  iniciado**. (Un lanzamiento previo del workflow reportó COMPLETE, pero era un
  falso positivo: el objective estaba hardcoded y el run reusó evidencia del
  seed-dev. El refresh real nunca corrió.) Release blocker del mini-ciclo.
- **Deuda: Eliminar el seed de datos de ejemplo** — pequeño, autocontenido, sin
  decisiones abiertas. Producto real en producción; el demo ya no corresponde.
- **Deuda: `pnpm-lock.yaml` dual** — un commit, borrar + gitignore. Trivial.
- **Deuda: `persistEntity` fire-and-forget sin `.catch`** — endurecer con catch
  + toast de error. Causa conocida (regresión F3). Sin decisiones abiertas.
- **Deuda: Migración `adminStores` idempotente** — falta el script
  `scripts/migrate-adminstores.cjs`; el test de la condición sí existe.
  Operación conocida.
- **Deuda: Vista de "usuarios de la plataforma" para el super_admin** — read-only
  lista de `users/{uid}` (email, rol, creado). **Desbloquea el selector de la
  feature de invitación** (decisión PO: invitar eligiendo de usuarios existentes,
  no escribiendo email a ciegas).
- **Compliance / Privacidad (Espec 2) — parte de CÓDIGO** — decisiones cerradas:
  arrancar `/privacidad/:slug` + edición del aviso con la plantilla marcada
  "sujeta a validación jurídica"; la parte legal (figura jurídica de Olivia,
  ATD) avanza en paralelo con Fer, fuera del código.
- **Unificar Catálogo e Inventario en "Productos"** — decisiones cerradas: (1)
  stock/costo editables por AMBOS caminos (ficha directa + compra — ya ocurre
  hoy); (2) Categorías y Compras viven DENTRO de la pestaña Productos. Hallazgo
  clave: `ProductForm` ya edita cost/quantityOnHand/prices → el cambio es
  mayormente de UI, no de modelo de datos.
- **Invitar miembros por correo (flujo confiable)** — decisiones cerradas: (1)
  reconciliación reusando `pendingInvites` + regla por-email (ponytail, sin
  colección nueva); (2) UI invita eligiendo de la lista de usuarios existentes
  (no email a ciegas) → **depende de la "vista de usuarios plataforma"** (hacer
  antes o junto).

### 🔴 Needs-spec (requiere escritura de spec — migración de datos o rediseño)
- **Recibos / comprobantes** — re-clasificado: la decisión PO de **rediseñar
  `Order` con `items[]`** (1 Order = 1 venta con varias líneas, como Purchase)
  convierte esto en una feature con migración de datos, no un botón de imprimir.
  Decisiones cerradas: fiscal-ready MVP, `window.print()`, no PAC, tamaño
  carta/A4, Fer diseña en Canva. PERO necesita spec porque migra Orders
  existentes y rediseña OrderForm. **Beneficia a Unificar Productos y al futuro
  checkout** — no es trabajo desperdiciado.
- **Precios escalables + precio sugerido** — rediseña el modelo de precios.
  4 decisiones abiertas (tiers globales vs por tienda, orden, regla de precio
  sugerido, migración canónica).
- **Editar el catálogo público in-place (WYSIWYG)** — probablemente se hace
  junto con la unificación; 4 decisiones abiertas.

### ❄️ Congelado (decisión del PO — no se define hasta que la dueña lo pida)
- **Roles por miembro (admin / vendedor / etc.)** — congelado: no se define
  hasta que la dueña lo pida. Mar hoy es `memberUid` y eso es estable.
  Rediseño de modelo (`memberUids` → `members` con rol). **No entra al workflow.**

### Deuda técnica (de sesiones, sin feature)

> **Release blocker del mini-ciclo:** el item "refresh = refresh" gobierna la
> prioridad de esta sección. Hasta que un refresh duro del navegador cargue
> estado fresco confiablemente (tras un deploy, tras un cambio de membresía,
> tras un cambio de sesión), el producto no se siente real.

- **"Un refresh debería funcionar como un refresh"** — reporte del PO: los datos
  se quedan estancados tras promover code changes; hay que garantizar que un
  refresh del navegador cargue siempre estado fresco. Síntoma amplio con varias
  hipótesis a investigar (en orden de probabilidad):
  1. **Service worker / PWA cache** delirando el bundle JS viejo tras un deploy
     (síntoma típico: "los cambios no aparecen hasta cerrar todas las pestañas
     o al día siguiente"). Store OS es PWA — verificar el ciclo de vida del SW,
     `skipWaiting`/`clients.claim`, y si `index.html` tiene cabeceras
     `no-cache` mientras los assets bundle llevan hash en el nombre.
  2. **`subscribeCloudState` no descubre docs nuevos** cuando el query inicial
     cargó vacío (lo que le pasó a Mar por el bug de dual-plane de abajo): el
     listener live no "ve" docs que antes no podía leer hasta un refresh duro.
     Confirmar si `loadCloudState` se re-corre limpio al recargar.
  3. **Firebase Auth persistence** (`browserLocalPersistence`) rehidratando
     sesión/state de IndexedDB viejos.
  4. **Cabeceras de cache de Vercel** para `index.html` y assets.
  **Criterio de cierre:** un test e2e que deployee un cambio, recargue, y
  afirme que el estado fresco aparece sin trucos. Relacionado con el bug
  dual-plane abajo (una de las causas confirmadas del síntoma "no aparece").
- **Dual-plane membership: `stores` y `adminStores` duplican `memberUids`/
  `ownerUid`/`pendingInvites`** — las Security Rules validan membresía contra
  `adminStores` (plano de control), pero la app lee de `stores` (plano de
  datos). El código normal escribe ambos atómicamente; pero ** editar Firestore
  directo (MCP, consola, manual) sin pasar por la app** deja los planos fuera
  de sync → el miembro aparece en `stores` pero la regla lo bloquea → selector
  vacío sin error visible. **Esto mordió a Mar** (arreglado a mano, ambos
  planos). Decisión de diseño pendiente: o `adminStores` es la única fuente de
  verdad (reglas y app leen de ahí), o el dual-write se documenta como
  invariante dura con un test que lo haga cumplir.
- **`pnpm-lock.yaml` commiteado junto a `package-lock.json`** — Vercel buildea con
  pnpm (detecta el lockfile), puede producir builds distintos a npm/local. Borrar
  y gitignorar.
  > **Delivery-ID: pnpm-lockfile.** La futura spec conserva este alcance; sólo cola `queued` + aprobación humana autoriza el cambio.
- **`persistEntity` fire-and-forget sin `.catch`** — un rechazo de Firestore
  queda como `pageerror` no manejado y el toast de éxito miente (ej: la regresión
  de persistencia de compras F3). Endurecer con `.catch` + toast de error.
  > **Delivery-ID: persist-entity-error-handling.** La futura spec debe exigir el toast de error y una prueba que fuerce el rechazo; `ready` no autoriza código.
- **Token Full Access de Vercel** — el `vcp_` project-scoped no cubre
  `vercel pull` (bug de Vercel); usamos Full Access. Pendiente re-bajar el scope
  cuando Vercel lo arregle.
- **Migración `adminStores` idempotente** — el hotfix del incidente
  Olivia-desaparece-de-prod fue manual; falta script `scripts/migrate-adminstores.cjs`
  + test de "store sin adminStores" (este último sí existe; falta el script).
  > **Delivery-ID: migrate-adminstores.** La futura spec conserva idempotencia y cobertura en emulador. Leer producción necesita aprobación humana específica y cualquier `--apply` una segunda aprobación separada.
- **Cascade al borrar cliente** — `deleteCustomer` no borra sus pedidos (quedan
  huérfanos mostrando "Sin cliente"). Hoy se advierte en el diálogo; decidir si
  cascade o bloqueo.
  > **🟡 needs-decision:** ¿cascade (borrar pedidos con el cliente) o bloqueo
  > (impedir borrar si tiene pedidos)? Hoy el diálogo solo advierte. El PO decide
  > antes de spec — tocar datos históricos de ventas es delicado.
- **`pendingInvites` no se reconcilia al entrar con Google** —
  `ensureUserDoc` (`src/app/firebase/auth.ts`) crea `users/{uid}` al loguear
  pero **nunca** convierte un `pendingInvite` existente en `memberUids`. La
  persona invitada por correo que entra por Google (ignorando el email-link)
  queda autenticada pero con selector de tienda vacío para siempre; la
  invitación UI se queda mostrando "pendiente". Confirmado en prod con Mar
  (arreglado a mano escribiendo su UID en `memberUids`). **Decisión cerrada:**
  reusar `pendingInvites` con una regla por-email (ponytail, sin colección
  nueva). Fix: en `ensureUserDoc`, tras crear el doc, buscar tiendas donde
  `pendingInvites` contenga el email y migrar el email → UID en `memberUids`
  de **ambos** planos (`stores` y `adminStores`) + limpiar `pendingInvites`.
  > **Parte de la feature 'Invitar miembros por correo'.** Hacer junto con esa
  > feature (misma entrega). La decisión técnica ya está cerrada
  > (reusar `pendingInvites` + regla por-email) — **no** reopening.
- **Sin vista de "usuarios de la plataforma" para el super_admin** — para
  descubrir quién entró (y con qué email real) hoy hay que ir a la consola de
  Firebase. El caso Mar lo enmascaró: el email dado (`chavez.maria.19pl`) no
  era el real (`oliviaaa.jewerly`); solo listando la colección `users` se vio
  la verdad. Mínimo: una lista read-only de `users/{uid}` (email, rol, creado)
  en el plano de control.
  > **Delivery-ID: platform-users-view.** La futura spec debe mantener la vista read-only, el aislamiento de roles y cero PII de clientas.
  >
  > **Readiness: 🟢 ready** y es **dependencia previa** de la feature de
  > invitación (la UI de invitar elige de esta lista, no email a ciegas).
- **`findUidByEmail` frágil contra normalización de Google** — la búsqueda
  (`auth.ts`) compara string exacto; si Google entrega el email canonicalizado
  distinto a como se escribió en la invitación, no atina y la invitación cae a
  `pendingInvites` en vez de `memberUids`. Normalizar ambos lados (lowercase +
  quitar puntos de Gmail) al comparar.
  > **Incluida en la feature 'Invitar miembros por correo'** (la normalización
  > va en esa misma entrega). No ejecutar aislado.
- **Eliminar el seed de datos de ejemplo** — Store OS ya es producto real en
  producción (Olivia operando, ventas reales). La opción de cargar datos
  ejemplo (Olivia/Santi/Joyería ficticios) ya no corresponde: confunde,
  ensucia el picker de tiendas si se activa, y contradice el cambio de 0.5.0
  que ya removió el modo demo. Borrar el código de seed del cliente + el
  script `scripts/seed-dev.cjs` queda **solo para dev/preview** (sembrar
  `store-os-dev`, nunca prod — aborta si `projectId !== 'store-os-dev'`),
  pero no expone nada en la UI de prod.
  > **Delivery-ID: remove-client-demo-seed.** La cola y una spec aprobada autorizan su implementación. Alcance: eliminar de la app cliente (`src/`) el seed ficticio, conservar `scripts/seed-dev.cjs` sólo para dev/preview y cubrir que una cuenta nueva no reciba datos demo.

---


## 💡 Invitar miembros por correo (flujo confiable)

**Estado:** 🟢 ready (decisiones cerradas 2026-08-11, depende de vista-usuarios)
**Solicitó:** Álvaro (PO), 2026-08-11 — incidente de acceso de Mar a Olivia
**Readiness:** 🟢 ready. Decisiones cerradas: (1) reconciliación reusando
`pendingInvites` + regla por-email (ponytail, sin colección nueva); (2) la UI
invita **eligiendo de la lista de usuarios existentes** (no email a ciegas) →
**depende de la "vista de usuarios plataforma"** (item ready). Hacer esa vista
antes o junto.

### Objetivo para la futura spec

> **Delivery-ID: reliable-member-invitations.** La cola mantiene su dependencia en `platform-users-view`. Su spec deberá conservar el alcance y los criterios detallados abajo; `ready` por sí solo no autoriza código.

### Problema

Cuando una dueña invita a alguien a su tienda, hoy el flujo es frágil:
`inviteMember` manda un **email-link de Firebase** y guarda el email en
`pendingInvites`. Pero ese email-link y el **login con Google** son dos caminos
que **no se cruzan**: si la persona invitada ignora el email-link y entra con
Google (lo más común — la gente prefiere Google), la invitación se queda
"pendiente" para siempre y la persona ve un **selector de tienda vacío**. El
incidente de Mar (2026-08-11) lo confirmó en prod: entró con Google, nunca vio
Olivia, hubo que añadir su UID a mano.

La causa raíz es de diseño, no de bug aislado: **`ensureUserDoc` crea el doc
`users/{uid}` al loguear, pero nunca reconcilia `pendingInvites` →
`memberUids`**. (Ese bug está registrado en deuda; esta feature es la cara de
producto que lo consume.)

### Alcance acordado

Un flujo de invitación que funcione sin importar cómo entre el invitado:

1. **Correo informativo (DECISIÓN TOMADA 2026-08-11):** la invitación envía un
   correo que **informa** ("Fer te invitó a colaborar en Olivia") y ofrece un
   botón "Entrar" que lleva a `/entrar`. El invitado **entra como quiera** —
   Google o email/password. **No** se exige el email-link exclusivo. Cero
   fricción, cero accounts duplicadas, compatible con la preferencia Google de
   la mayoría.
2. **Reconciliación al loguear:** cuando el invitado completa el login (por
   cualquier método), `ensureUserDoc` busca tiendas donde `pendingInvites`
   contenga su email y, para cada una, **mueve el email → UID**: añade el UID
   a `memberUids` y limpia el email de `pendingInvites`. Así el selector deja
   de estar vacío sin intervención manual.
3. **UI honesta:** el estado "pendiente" en la lista de miembros refleja solo
   invitaciones cuyo email **todavía no** se ha reconciliado con un login; al
   loguear el invitado, desaparece del pendiente y aparece como miembro real.
4. **Robustez de email:** normalizar al comparar (lowercase; Gmail ignora
   puntos — tratar `a.b@gmail.com` == `ab@gmail.com`) para que el
   `findUidByEmail` de la UI de invitación y la reconciliación no fallen por
   formato. (Componente del bug de deuda `findUidByEmail` frágil.)

### Datos disponibles vs faltantes

**Hoy:** `stores.pendingInvites: string[]`, `stores.memberUids: string[]`,
`users/{uid}` con `email`. `inviteMember` (`StoreProvider.tsx`),
`sendInviteLink`/`completeInviteSignIn` (`auth.ts`), `findUidByEmail`.

**Decidido (2026-08-11) — ya NO son decisiones abiertas:**
- **Reconciliación:** reuse `pendingInvites` con una regla por-email (ponytail,
  sin colección nueva). En `ensureUserDoc`, al loguear, migrar email→UID en
  `memberUids` de **ambos** planos (`stores` y `adminStores`) + limpiar
  `pendingInvites`.
- **Correo:** informativo, reusando el email-link de Firebase como botón
  "Entrar" (gratis, ya cableado, cero-costos). NO transaccional exclusivo.
- **Email que no coincide:** la UI invita **eligiendo de la lista de usuarios
  existentes** (no email a ciegas) → **depende de la "vista de usuarios
  plataforma"** (hacer antes o junto). Evita el caso Mar.
- **Query por-email y reglas:** se necesita una regla nueva que permita leer
  `stores` filtrando por `pendingInvites` que contenga el email del solicitante
  (antes de ser miembro). Es un detalle de implementación a resolver en la
  fase de arquitectura del workflow, NO una decisión de producto abierta.

### Estado de decisiones

**Ninguna de producto.** Las tres decisiones que abrían esta sección (correo,
reconciliación, email-distinto) están cerradas arriba. Lo que queda son detalles
técnicos que el workflow resuelve en su fase de arquitectura (la regla
por-email, el batched write dual-plane). Esta feature está **ready** y depende
solo de la "vista de usuarios plataforma".

### Out-of-scope explícito

- Roles por miembro (admin/vendedor) — entrada aparte; **no** se define aquí.
- Aceptar/rechazar la invitación explícitamente (la dueña ya decidió invitar;
   el login = aceptación tácita; agregar un paso de "aceptar" es fricción
   innecesaria YAGNI).
- Invitaciones expirables / revocables por tiempo (YAGNI; la dueña puede quitar
   miembros cuando quiera).

### Notas

- Esta feature **depende** del fix de deuda `pendingInvites` no reconcilia —
  son la misma obra desde dos ángulos (deuda = la causa técnica; feature = la
  experiencia de producto). Hacerlos juntos.
- Lección del incidente Mar: no pedir un email libre. La UI elige una cuenta
  existente de la plataforma, cuya dirección ya corresponde al usuario real.

---


## 💡 Roles por miembro (admin / vendedor / etc.)

**Estado:** ❄️ frozen (por decisión del PO — no se define hasta que la dueña lo pida)
**Solicitó:** Álvaro (PO), 2026-08-11
**Readiness:** 🔴 congelado. **No entra al workflow.** Registrado para no perder el contexto; cuando la dueña (Fer/Mar) reporte la necesidad de delegar administración, se descongela y se escribe spec.

### Objetivo para la futura spec

> **N/A — congelado.** No hay objetivo hasta que el PO lo reactive. Descongelar
> requiere: (1) decisión de cuántos perfiles y cuáles, con Fer; (2) rediseño de
> modelo (`memberUids: string[]` → `members: {uid, role, addedAt}[]`); (3)
> reglas por `storeRole`. Mientras tanto, Mar es `memberUid` y eso es estable.

### Problema

Hoy Store OS tiene **dos niveles de acceso** de facto:
- **`ownerUid`** (dueña) — gestiona miembros (invitar/quitar), transfiere
  propiedad, elimina la tienda, edita todo.
- **`memberUids`** (miembro) — opera la tienda (productos, pedidos, clientes,
  compras) pero **no** gestiona miembros ni acciones destructivas.

Eso no basta cuando la dueña quiere delegar administración sin ceder la
propiedad. Caso Mar: ella es la **administradora operativa** de Olivia, pero
no la dueña registral; bajo el modelo actual no puede invitar a terceros sin
que se le transfiera el `ownerUid` (lo cual removería el control del
super_admin sobre la tienda).

### Por qué NO se define ahora

La dueña (Fer/Álvaro) lo decide cuando lo necesite. Definir perfiles prematuros
= spec para un necesidad que no se ha materializado = sobre-ingeniería. Se
registra para que no se pierda.

### Alcance propuesto (cuando se decida)

- Un campo `role` por membresía: `member.storeRole: "admin" | "seller" | ...`
  (hoy no existe; `memberUids` es un array plano de UIDs sin metadata).
- Probablemente requiere migrar `memberUids: string[]` →
  `members: {uid, role, addedAt}[]` (o un subcollection). Eso es un
  rediseño de modelo — spec propia, no trivial.
- Perfiles tentativos a refinar con la dueña:
  - **Admin** — todo lo operativo + gestionar miembros (invitar/quitar), sin
    poder eliminar la tienda ni transferir propiedad (eso queda al `ownerUid`).
  - **Vendedor/operador** — solo operativo (productos, pedidos, clientes).
  - (Posibles: solo-lectura, solo-catálogo, etc. — YAGNI hasta que se pida.)

### Decisiones pendientes (para cuando se defina)

1. ¿Cuántos perfiles y cuáles? (Definir con Fer.)
2. ¿`members` como subcolección o array de objetos en el doc de tienda?
3. Migración de `memberUids` existentes (Mar, futuros) → `members` con rol
   default.
4. Reglas de Firestore por `storeRole` (no solo `memberUids.hasAny`).

### Nota

- **Mar hoy es `memberUid`** (opera Olivia, no gestiona miembros). Ese estado es
  correcto y estable hasta que este feature exista. No transferir `ownerUid`
  mientras tanto (removería el hook del super_admin sobre la tienda).
- Interactúa con la feature de invitación: el perfil del invitado debería poder
  elegirse al invitar (hoy no, porque solo hay un nivel de miembro).

---


## 🔴 Recibos / comprobantes de venta imprimibles y PDF

**Estado:** 🔴 needs-spec (re-clasificado 2026-08-11 — requiere migración de Order)
**Solicitó:** Fer (dueña de Olivia), vía Álvaro (2026-08-05)
**Readiness:** 🔴 needs-spec. La decisión PO de **rediseñar `Order` con
`items[]`** convierte esto en feature con migración de datos, no un botón de
imprimir. Decisiones cerradas: fiscal-ready MVP, `window.print()`, no PAC,
tamaño carta/A4, Fer diseña en Canva. **Beneficia a Unificar Productos y al
futuro checkout** — el rediseño de Order no es trabajo desperdiciado.

### Objetivo para el workflow

> **N/A hasta spec** (writing-plans obligatorio por la migración de Order).
> Cuando la spec exista, el objetivo será: (1) rediseñar `Order` de
> `{productId, productName, quantity, price, cost}` a `{items: OrderLine[]}`
> donde cada línea lleva producto/cantidad/precio/costo — una venta = un Order
> con N líneas (como Purchase.lines hoy); (2) migración idempotente de Orders
> existentes (cada Order viejo → Order nuevo con 1 item); (3) rediseñar
> OrderForm para capturar varias líneas; (4) recibo imprimible/PDF por Order
> (window.print + CSS @media print, tamaño carta/A4), plantilla de Olivia (Fer
> da referencia Canva), campos fiscal-ready con defaults invisibles; (5) folio
> consecutivo por tienda (receiptSeq). NO: timbrado PAC, diseñador visual,
> envío WhatsApp automático. **No inventar en el harness** — la migración de
> Order toca types, OrderForm, catálogo, proyecciones y debe planearse.

### Problema

Fer quiere entregar a sus clientas un comprobante profesional cuando concreta
una venta: un recibo con el diseño de su marca, que se pueda **imprimir** o
**enviar como PDF** (por WhatsApp, normalmente). Hoy Store OS registra el
pedido pero no genera ningún documento para la clienta. Referencia mental de
Fer: Crystal Reports (un diseño único de reporte que se carga con datos y se
imprime/exporta).

### Alcance propuesto (MVP)

Un recibo por **pedido** (`Order`), generado en el navegador a partir de una
**plantilla de diseño fija** que refleja la marca de Olivia, rellena con los
datos del pedido + la clienta + la tienda. Botón "Imprimir / Guardar PDF" usa
`window.print()` con CSS `@media print` (el diálogo del navegador ya ofrece
"Guardar como PDF"). Sin diseñador visual embebido en esta iteración.

**Por qué no un diseñador visual (estilo Crystal Reports):** construir un
editor WYSIWYG de plantillas es un proyecto entero y es over-engineering para
una sola joyería. Fer entrega su diseño (imagen/Figma/papel) y se implementa
como plantilla. Si después quiere más control de marca, se añaden **tokens de
personalización** (logo, colores, texto fijo) — ese es el punto dulce, no un
editor completo.

### Datos disponibles vs faltantes

Ya en `Order` (`src/types/index.ts`): `productName`, `quantity`, `price`,
`deposit` (anticipo), `promisedDate`, `notes`, `status` (incl. `delivered`/
`paid`), `createdAt`.

Ya en la tienda: nombre, WhatsApp (`Store`).

**Faltan (a decidir en spec):**
- **Número de recibo consecutivo** por tienda (ej. `REC-0001`). Requiere un
  contador — probablemente un campo `receiptSeq` en `Store` incrementado al
  emitir, con cuidado de concurrencia (igual que el slug claim).
- **Datos de la clienta** en el recibo: nombre, teléfono. Hoy están en
  `Customer` (relacionado por `order.customerId`), hay que resolverlos.
- **Forma de pago** (efectivo/transferencia/tarjeta) y **saldo** (`price −
  deposit`). El saldo se calcula; la forma de pago es campo nuevo en `Order` o
  se captura al emitir.
- **Logo de la tienda** en el recibo (¿usar el del storefront? ¿uno aparte?).
- **Campos fiscal-ready** (ver decisión 1): forma de pago (clave SAT), uso del
  CFDI (default G03), unidad (default pieza=H87), RFC de la clienta
  (opcional). Capturados hoy, con defaults invisibles, para que el timbrado
  futuro no rediseñe el modelo.

**Campos fiscal-ready (capturar hoy, opcionales con defaults):**

| Campo | Default (no estorba hoy) | Por qué lo necesita la factura futura |
|---|---|---|
| Forma de pago | "Por definir" | El CFDI exige clave SAT (efectivo=01, transferencia=03, etc.) |
| Uso del CFDI | "G03 — Gastos en general" | Requerido por el SAT (uso que le da la clienta) |
| Unidad | "Pieza" (H87) | Cada línea del CFDI exige unidad SAT |
| RFC de la clienta | vacío (el recibo no lo exige) | La factura lo exige; se pide cuando la clienta lo solicite |
| Régimen fiscal de Fer | se configura una vez por tienda | Requerido en todo CFDI del emisor |

### Decisiones pendientes (cerrar antes de spec)

1. **¿Recibo o factura fiscal (CFDI)?** ⚠️ DECISIÓN TOMADA (2026-08-05):
   **Tamaño carta**, y **construimos fiscal-ready desde el MVP aunque no
   timbremos cada recibo**. La distinción que rige el diseño:
   - **Datos fiscales de la operación** (clienta, productos, montos, forma de
     pago, uso del CFDI, unidad, RFC) → se **capturan y guardan hoy**, sin
     costar nada. La mayoría son defaults invisibles para Fer.
   - **Timbrado** (enviar al PAC, recibir XML+PDF sellado) → **se pospone**.
     Cobra por comprobante, rompe cero-costos; es integración aparte.
   - **Principio:** el recibo de hoy captura ya los campos que una factura
     futura necesitará, para que cuando llegue el timbrado los datos ya estén
     y solo se añada el PAC encima — sin rediseñar el modelo ni recapturar
     historial. **No** se construye la integración PAC ahora (YAGNI + costo).
   - Flujo que esto habilita: Fer emite recibo normal → si la clienta pide
     factura después, los datos ya están; solo se confirma RFC y se timbra.

2. **¿Una plantilla por tienda o global?** Olivia es la primera, pero si hay
   más tiendas, ¿cada una sube su diseño? MVP: una plantilla Olivia; la
   arquitectura debe permitir por-tienda sin reescribir (YAGNI: no construir el
   multi-tienda hasta que haya 2+ pidiéndolo).

3. **¿Quién diseña la plantilla?** Fer diseña en **Canva** (herramienta que
   domina): paleta, tipografía, logo, layout, copy del encabezado. Exporta un
   PDF de muestra con datos de ejemplo. Ese PDF es la **referencia visual**;
   el diseño se **reconstruye como HTML/CSS** dentro de la app — Canva es el
   origen del diseño, NO el motor de plantillas (no se carga el archivo de
   Canva en runtime; Store OS rellena la plantilla HTML con los datos de cada
   pedido). MVP: implementar fielmente el diseño de Canva de Fer.

   3b. **Tamaño del recibo:** ¿carta/A4 (para imprimir en impresora normal o
   generar PDF para WhatsApp) o **ticket térmico** (rollo 58/80mm, impresora
   de punto de venta)? El CSS `@media print` es muy distinto para cada uno.
   Va al spec cuando se confirme con Fer.

4. **¿PDF nativo o `window.print()`?** `window.print()` + CSS print es gratis y
   suficiente (el diálogo del SO hace "Guardar como PDF"). Una librería de PDF
   (jsPDF/pdfmake) añade tamaño al bundle y complejidad. MVP: `window.print()`.

5. **Cero-costos:** confirmar que no hay servicio de backend (sin Cloud
   Function de render). Todo en el cliente.

### Out-of-scope explícito

- Facturación fiscal / CFDI / PAC (hasta que se decida, y asumiendo costo).
- Diseñador visual de plantillas embebido (YAGNI).
- Envío automático por WhatsApp (Fer puede "compartir" el PDF desde su teléfono
  tras guardarlo; el botón de WhatsApp ya existe en otro contexto).
- Plantillas para múltiples documentos (solo recibo de venta por ahora).

### Notas de implementación (cuando toque)

- El recibo es **proyección de solo lectura** de datos existentes (como el
  catálogo público) — no nueva colección salvo el contador de folio.
- CSS `@media print` con `@page` para tamaño (media carta / ticket térmico).
- Validar mobile-first: Fer opera desde el teléfono; el "Guardar como PDF"
  móvil debe ser obvio.
- Considerar que `Order` hoy parece ser **una línea por producto** (ver
  `productId`/`productName` singular). Un recibo suele agrupar varias líneas:
  confirmar si un "pedido" es un `Order` o un grupo de `Order`s (esto afecta
  el diseño del folio y el agrupamiento).

---

## 💡 Unificar Catálogo e Inventario en una sola pestaña "Productos"

**Estado:** 🟢 ready (decisiones cerradas 2026-08-11)
**Solicitó:** Álvaro (PO), 2026-08-11 — conversación de diseño
**Readiness:** 🟢 ready. Decisiones cerradas: (1) stock/costo editables por
AMBOS caminos (ficha directa + compra — ya ocurre hoy en ProductForm); (2)
Categorías y Compras viven DENTRO de Productos. Hallazgo clave: ProductForm ya
edita cost/quantityOnHand/prices → el cambio es mayormente de UI.

### Objetivo para el workflow

> **Delivery-ID: unified-products.** Su futura spec deberá conservar las decisiones y criterios detallados abajo. La cola y una aprobación humana, no este estado `ready`, autorizan código.

### Problema

Hoy el admin tiene dos pestañas separadas: **Catálogo** (`/catalogo-admin`, con
Productos y Categorías) e **Inventario** (`/inventario`, con stock, costo y
compras). Para una joyería pequeña como Olivia (una sola operadora, Fer), esa
separación es artificial: Fer no piensa "voy al catálogo a poner el precio y
luego al inventario a poner la existencia". Ella piensa "agrego un Anillo" con
todo junto (nombre, foto, precio, costo, cuántos tiene). Es **un solo objeto
mental**, hoy partido en dos pantallas.

La fricción ya se manifestó en esta sesión: el flujo de compra tuvo que añadir
"crear producto al vuelo" (F2) y "editar precio desde la compra" (F3)
**justamente porque stock y catálogo estaban desconectados**. Mover entre
"Catálogo → editar precio" e "Inventario → ver stock" del mismo producto es ir
y venir.

### Alcance acordado

Fusionar en **una sola pestaña "Productos"** que muestre cada producto completo:
foto, nombre, precios, existencia y badge de publicado/borrador, todo junto.
Editar abre la ficha con todo (datos de catálogo + precios + stock + costo).
"Compras a proveedores" y "Categorías" quedan como sub-flujos dentro de
Productos.

- Una sola lista por producto con todos sus datos visibles.
- Una sola ficha de edición: la actual `ProductForm` ya permite editar
  existencia, costo y precios directamente; el flujo de compra conserva el
  promedio ponderado como segundo camino.
- "Compras" y "Categorías" se reubican dentro de Productos.

### Datos disponibles vs faltantes

Ya existe casi todo: `Product` lleva `quantityOnHand`, `cost`, `prices`, fotos,
`status`, y `ProductForm` ya edita esos datos. `InventoryScreen` y
`CatalogScreen` se fusionan sin cambiar el modelo.

### Decisiones cerradas

1. Stock y costo se editan tanto en la ficha como al registrar una compra.
2. Categorías y Compras viven dentro de Productos.
3. Productos sustituye las pestañas separadas de Catálogo e Inventario.

### Out-of-scope explícito

- Conteo de inventario avanzado / ajustes con motivo / auditoría (YAGNI).

---

## 💡 Precios escalables (nombres mutables + extensibles) y precio sugerido

**Estado:** 💡 idea
**Solicitó:** Fer (dueña de Olivia), vía Álvaro (2026-08-10)
**Readiness:** 🔴 needs-spec. Rediseña el modelo de precios — feature con spec propia. 4 decisiones abiertas. No entra al workflow hasta tener spec firmada.

### Objetivo para la entrega

> **N/A hasta spec.** Este item rediseña el modelo (`ProductPrices` enum →
> `prices: {[tierId]:n}` + `store.priceTiers`). Requiere writing-plans antes de
> IMPLEMENTATION. Cuando la spec exista, el objetivo será: reemplazar el enum
> fijo por tiers por tienda (nombres mutables, extensibles), migración
> idempotente que preserve los 3 precios existentes, y precio sugerido desde el
> costo como asistente configurable. Impacta tipos, ProductForm, OrderForm,
> catálogo público, proyecciones. **No inventar las 4 decisiones en el harness.**

### Problema

Olivia maneja **varios precios por producto** (hoy: mayoreo, menudeo,
emprendedora). Hoy existen como un enum fijo de 3 (`retail | wholesale | reseller`
en `ProductPrices`). Fer necesita que:

1. Los **nombres** de esos precios puedan **cambiar** (no son "retail/wholesale"
   para siempre — son etiquetas comerciales que ella controla).
2. Se puedan **agregar precios nuevos** sin rehacer tablas ni migrar esquema.
3. (Deseo futuro) Una **fórmula/técnica que sugiera el precio de venta al público
   a partir del costo** del producto.

### Alcance propuesto (idea — requiere spec)

- **Modelo extensible:** reemplazar el enum fijo por un modelo tipo
  `prices: { [tierId: string]: number }` + una definición de tiers **por tienda**
  (`store.priceTiers: { id, label, order }[]`). La tienda define cuántos precios
  hay y cómo se llaman; el producto solo guarda los valores por tier id.
- **Nombres mutables:** cambiar el `label` de un tier no rompe los productos (el
  id estable se mantiene; el label es cosmético).
- **Agregar/ordenar/quitar** tiers desde la configuración de la tienda, sin
  tocar documentos de producto existentes (los que no tengan un tier nuevo
  simplemente quedan sin ese precio).
- **Precio sugerido desde el costo** (sub-idea): cuando Fer captura el `cost`,
  sugerir un precio de venta con una regla configurable (markup %, margen
  objetivo). Es **asistente**, no obligación — ella puede sobreescribir. Va en
  su propia iteración; capturar la regla en `store.pricingRule`.

### Datos disponibles vs faltantes

**Hoy:** `Product.prices?: { retail?, wholesale?, reseller? }` (3 fijos, enum
duro), `Product.cost?`, `PriceTier` enum, campos en `ProductForm` y
`OrderForm`. El catálogo público y las órdenes leen `prices[tier]`.

**Faltan (a decidir en spec):**
- Definición de tiers por tienda (`Store.priceTiers`).
- Migración de `prices: {retail,wholesale,reseller}` → `prices: {[tierId]:n}`
  (idempotente, preserva datos).
- Cómo se elige el tier por defecto (¿el primero? ¿un `defaultTierId`?).
- Regla de precio sugerido (formato, dónde se configura).
- Cómo cambia el `OrderForm` (hoy usa `PriceTier` enum duro).

### Decisiones pendientes (cerrar antes de spec)

1. ¿Nombres de tier globales o por tienda? (Por tienda = Fer controla; implica
   `Store.priceTiers`.)
2. ¿Los tiers tienen orden explícito (para mostrar en forms/catálogo)?
3. ¿Precio sugerido = markup fijo, margen objetivo, o tabla por rango de costo?
4. Migración: ¿un tier id canónico para retail/wholesale/reseller existentes
   (`t_retail` etc.) para no perder datos?

### Out-of-scope explícito

- Descuentos por volumen complejos / reglas de pricing dinámico.
- Histórico de precios por producto (YAGNI).

### Nota

Este cambio **rediseña el modelo de precios** — es una feature con spec propia,
no un fix. Impacta tipos, `ProductForm`, `OrderForm`, catálogo público,
proyecciones y migración. Mientras tanto, el bug de que Olivia no mostraba los 3
precios existentes (porque `adminStores` no llevaba `type`) **ya está arreglado**
— los 3 precios actuales funcionan para Fer hoy.

---

---

## 💡 Editar el catálogo público in-place (WYSIWYG)

**Estado:** 💡 idea
**Solicitó:** Álvaro (PO), 2026-08-11
**Readiness:** 🔴 needs-spec. Probablemente se hace junto con Unificar Productos (son las dos caras de la misma moneda). 4 decisiones abiertas.

### Objetivo para el workflow

> **N/A hasta spec, y preferentemente agrupado con Unificar Productos.** Edición
> WYSIWYG del storefront sobre `/catalogo/:slug` (modo editar solo para
> dueño/admin logueado). Persiste a `publicStores/{slug}.storefront` +
> `stores/{id}.storefront`. La clienta anónima ve solo lectura. No entra al
> harness hasta definir: campos editables, alcance (¿solo storefront o también
> ordenar/ocultar productos?), persistencia (on-blur vs modo edición global),
> permisos (¿owner o miembros?).

### Problema

Hoy la tienda pública se edita desde **Ajustes de tienda → StorefrontEditor**
(hero, historia, FAQ, etc.) — un formulario aparte, desconectado de lo que la
clienta ve. Fer quiere editar el contenido público **directamente sobre la vista
pública** (click en el texto → edita), viendo el resultado en contexto, no en
un formulario separado.

### Alcance propuesto (idea — requiere spec)

Edición WYSIWYG del storefront: un modo "editar" (solo para el dueño/admin
logueado) sobre `/catalogo/:slug` donde los textos editables (hero, cuerpo,
historia, FAQ, envíos, etc.) se hacen clickeables; al click, un input/textarea
inline reemplaza el texto; al guardar, persiste a `publicStores/{slug}.storefront`
+ `stores/{id}.storefront`. La clienta anónima sigue viendo la versión de solo
lectura.

Probablemente conviene hacerlo **junto con** la unificación Catálogo/Inventario
(entrada anterior): si "Productos" es la única pestaña admin, la vista pública
+WYSIWYG encaja como la otra cara de esa misma moneda.

### Decisiones pendientes (cerrar antes de spec)

1. ¿Qué campos son editables in-place? (¿todos los del `storefront`, o un subset?)
2. ¿El WYSIWYG edita solo storefront, o también reordenar/ocultar productos?
3. ¿Cómo se persiste (por campo on-blur, o un modo "edición" con guardado global)?
4. ¿Permisos: solo owner, o miembros también?

### Out-of-scope explícito

- Editor visual de layout/colores (esos van por tokens de tema, ya existente).
- Multi-idioma (YAGNI).

---

## 📋 Compliance / Privacidad (Espec 2) — PRÓXIMO CICLO

**Estado:** 📋 specced (diseño aprobado, sin implementar)
**Prioridad:** alta — próxima a implementar tras el ciclo del flujo de compra.
**Spec:** `docs/superpowers/specs/2026-08-06-privacidad-arco-v1-design.md`
**Readiness:** 🟢 ready (parte de CÓDIGO). Decisiones cerradas: el código arranca
con `/privacidad/:slug` + edición del aviso usando una plantilla marcada
"sujeta a validación jurídica". El trabajo legal/humano (figura jurídica de
Olivia, ATD, redacción final) avanza **en paralelo con Fer**, fuera del código —
es dependencia paralela, **no** bloqueador técnico. El índice ya clasifica esto
como 🟢 ready.

### Objetivo para el workflow

> **Delivery-ID: privacy-arco-v1.** La spec está en `Pending approval`; el harness pausa hasta que una persona añada `Approved-By`, cambie el estado a `Approved`, fusione la spec y ponga la entrada en `queued`.

### Qué está aprobado (diseño)

- **`/privacidad/:slug`** — aviso de privacidad público de la tienda (Olivia),
  informativo y de contacto (WhatsApp/correo), **sin formulario ni escrituras
  anónimas a Firestore**. Contenido editable por la dueña en
  StoreSettingsScreen, basado en plantilla con requisitos LFPDPPP arts. 15-16:
  identidad del sujeto jurídico, datos tratados, derechos ARCO, canales,
  encargados (Store OS, Google/Firebase, Vercel). Sujeto a validación jurídica.
- **ARCO V1 asistido por la responsable** (Fer gestiona las solicitudes; la
  página pública solo informa y da canales, no crea documentos).
- Separación de planos: super_admin = plano de CONTROL, sin PII rutinaria de
  clientas. (Espec 1 ya implementada y mergeada en PR #11.)

### Lo que falta

- Plan de implementación (writing-plans) → código → QA → release.
- Cero código de Espec 2 existe hoy (solo la spec).

**Nota:** Espec 1 (security harness, G-P01–G-P08) **ya está implementada y
mergeada** (PR #11). Este backlog entry cubre solo Espec 2.

---

<!-- Plantilla para nuevas entradas:

## 💡 [Título]

**Estado:** 💡 idea
**Solicitó:** [quién, cuándo]

### Problema
[Qué necesita la usuaria, en sus términos]

### Alcance propuesto (MVP)
[La versión más simple que resuelva el problema]

### Datos disponibles vs faltantes
[Qué hay en los tipos hoy, qué falta]

### Decisiones pendientes
[Preguntas que cerrar antes de spec]

### Out-of-scope explícito
[Lo que NO se hace esta iteración]
-->
