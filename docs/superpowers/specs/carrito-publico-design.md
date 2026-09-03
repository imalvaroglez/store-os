---
Delivery-ID: carrito-publico
Delivery-Status: Implemented
specPath: docs/superpowers/specs/carrito-publico-design.md
---
# Carrito público: acumular piezas y solicitar varias por WhatsApp

> **Revisión vigente (2026-09-03):** el alcance ya incluye el catálogo
> genérico además de Olivia y usa Iconic como objetivo comercial. Las reglas
> actuales del carrito y de precios sustituyen las decisiones preliminares de
> “sólo Olivia” y de niveles meramente informativos descritas abajo.

## Problema

El storefront público de Olivia solo permite preguntar por **una pieza a la
vez** (`createStorefrontBuyUrl`, `src/lib/whatsapp.ts:66-78`): cada compra es
un mensaje suelto con una pieza. Una clienta que quiere varias piezas debe
abrir un chat por pieza. Además, los precios por tier (Regular / Girly /
Iconic) son invisibles para el público: la proyección expone **un solo
precio** resuelto al tier default, por diseño
(`firestoreData.ts:467-468`, invariante testeado en `firestoreData.test.ts:86`).

**Decisión del owner (sesión brainstorm 2026-08-29, diseño aprobado):**

1. El carrito vive en Olivia y en el catálogo público genérico; el flujo es el
   mismo para cualquier tienda publicada.
2. Los 3 precios por tier **se hacen públicos** (con sus mínimos). Se
   actualiza el invariante de proyección — decisión de negocio explícita.
3. Tiers **solo informativos** en el carrito: sin selección ni totales
   comprometidos en v1; el precio final se cierra en el chat.
4. Con **cantidades** por pieza (stepper ±).
5. La proyección expone la señal de stock y, para tiendas de inventario, el
   número entero `availableQuantity`. Es una decisión pública deliberada para
   que el cliente no pueda pedir más piezas de las disponibles.
6. Los tiers ganan **mínimos de calificación**: Regular sin mínimo, Girly
   desde 5 piezas, Iconic desde $1,000 de compra (datos, editables,
   **nunca forzados en cliente** — informativos; el owner confirma en chat).
7. Persistencia del carrito en `localStorage` por tienda. El envío no es un
   write anónimo del navegador: una callable valida y crea una `orders/{id}`
   con estado `requested`; la solicitud no aparta stock hasta que la dueña la
   acepta.

## Objetivo

1. Una visitante anónima acumula piezas con cantidades en un carrito que
   sobrevive recargas, revisa su pedido y lo envía en **un solo mensaje de
   WhatsApp** con todas las líneas.
2. El catálogo muestra los 3 precios con su nombre y mínimo de calificación.
3. El stepper nunca permite superar `availableQuantity`; el servidor repite la
   validación. Las solicitudes aceptadas convierten el nombre en una clienta,
   apartan el inventario y continúan como pedido normal "Por cotizar".

## Alcance (in)

### 1. Modelo: mínimos de tier (`src/types/index.ts:105-110`)

```ts
export type PriceTierDef = {
  id: string; label: string; order: number; hidden?: boolean;
  minPieces?: number;   // califica por número de piezas (Girly: 5)
  minAmount?: number;   // califica por monto a precio DEL PROPIO tier (Iconic: 1000)
};
```

**Semántica de calificación (regla del owner, 2026-08-29):**

- `minPieces`: el total de piezas del carrito ≥ `minPieces`.
- `minAmount`: `Σ(cantidad × precio DE ESE tier) ≥ minAmount` — **nunca** el
  total a precio regular/default. Ejemplo del owner: 10 piezas × $140
  (regular) = $1,400 **no** califican para Iconic ($1,000), porque a precio
  Iconic ($95) son $950; con 11 × $95 = $1,045 sí. La regla empuja comprar
  más producto a cambio del mejor precio.

- Editor en `StoreSettingsScreen` (Niveles de precio, `:374-443`): dos campos
  numéricos opcionales por tier; vacío = sin mínimo.
- Los labels comerciales ("Regular", "Girly", "Iconic") ya son editables hoy;
  no se tocan.

### 2. Proyección pública ampliada (`firestoreData.ts` + `publicCatalog.ts`)

- `projectPublicStore` (`:453-464`): += `priceTiers` (visibles, con
  `minPieces/minAmount`) y `defaultTierId`. Tipo `PublicStore` (`:45-51`) se
  extiende igual.
- `projectPublicProductSummary` / `projectPublicProductDetail`:
  += `prices: Record<string, number>` (solo tiers visibles),
  `stockSignal: "agotado" | "pocas" | "disponible"` (`0` / `<= lowStockAt` /
  resto) y, en resúmenes de inventario, `availableQuantity`. El `price` único
  se conserva (compatibilidad y orden grid).
- Actualizar el invariante y sus tests (`firestoreData.test.ts:86`, `:239`):
  el tier map es público **por decisión del owner**; `cost` sigue privado.
- Reglas: sin cambios (los 3 docs públicos ya son de lectura anónima y la
  escritura es owner/member). Republicar tras deploy para refrescar docs
  existentes ("Republicar catálogo").

### 3. Storefront (`OliviaStorefront.tsx`)

- **Detalle:** tabla de precios por tier — nombre, precio y mínimo, con el
  monto siempre referido al precio del propio tier ("Girly · desde 5 piezas"
  / "Iconic · desde $1,000 a precio Iconic"); el default resaltado.
  Fallback: proyección estancada sin tiers → solo el precio único actual.
- **Botón "Agregar al carrito"** en detalle y en cada card del grid (agrega
  la cantidad 1 o incrementa si ya está).
- **Botón flotante** con contador de piezas → abre el carrito.

### 4. Carrito (nuevo `CartDrawer` sobre el `Sheet` del design system)

- Líneas: miniatura, nombre, stepper ± (mín 1, quitar), señal de stock por
  línea. Copys de la leyenda (tono que invita a ordenar, textos exactos en
  implementación):
  - `"pocas"` → *"Quedan pocas — tu pedido puede reabastecerse y entregarse
    completo 💛"*
  - `"agotado"` → *"Se puede hacer sobre pedido — te confirmamos fecha de
    reabastecimiento 💛"*
- **Revisión (pre-checkout):** resumen de líneas + hint de ventas calculado
  en cliente con la semántica de calificación de arriba (todo con datos
  públicos, sin comprometer precio):
  - Si ya califica un tier: *"con precio Girly ahorras $N frente a menudeo"*
    (N = Σ cantidad × (precio menudeo − precio tier) del carrito).
  - Si falta para el siguiente tier: brecha + valor — *"a precio Iconic te
    faltan $50 o 1 pieza más: por $95 más te llevas $140 de producto
    (a precio menudeo) y todo tu pedido ahorra frente a menudeo"*
    (enfoque del owner 2026-08-29: mostrar cuánto se ahorra y cuánto valor
    se gana por cerrar la brecha; incentiva pedidos más grandes).
  - Informativo: no obliga a nada; el precio lo confirma el owner en el
    chat.
- **Checkout = solicitud + WhatsApp:** el botón exige nombre y envía ids,
  cantidades y nombre a `submitPublicOrderRequest` (callable). Al recibir el
  folio, abre WhatsApp con `buildCartOrderUrl` y la referencia; WhatsApp es el
  canal de conversación, no la frontera de inventario.
- El detalle de producto sólo muestra "Agregar al carrito". El contacto
  general vive en el pie global de la tienda.

### 5. Estado (`useCart` hook + `src/lib/cart.ts`)

- `localStorage` con clave por tienda (`store-os:cart:{slug}`), versión de
  esquema, tolerante a JSON corrupto (descarta y empieza limpio).
- Opera sobre datos **públicos** (summary: id, slug, nombre, sku); si una
  pieza ya no está en la proyección, la línea se descarta en silencio al
  renderizar.

## Alcance (out)

- Totales, selección de tier por línea y forzado de mínimos en cliente (el
  precio lo confirma la dueña en el chat).
- Backend de carritos, sync cross-device y cuentas de visitante.
- Métricas de carritos abandonados.
- CAPTCHA/App Check y protección DDoS avanzada; V1 usa límites económicos y
  de abuso: una solicitud por navegador cada 5 minutos, por IP cada minuto,
  por tienda, y un fusible global de 500 solicitudes UTC/día. Los límites se
  guardan como hashes en `publicOrderLimits` y se limpian con TTL.

## Criterios de aceptación

1. Agregar 3 piezas distintas → contador 3 → drawer muestra 3 líneas →
   "Enviar pedido" abre `wa.me` con las 3 líneas y el link; sobrevive
   recarga (localStorage).
2. Stepper ± actualiza líneas y contador; quitar elimina la línea.
3. Detalle muestra los 3 precios con mínimos; con proyección estancada cae
   al precio único sin romper.
4. El catálogo muestra la señal y el máximo exacto sólo en inventario; el
   stepper y el servidor rechazan cantidades superiores al máximo.
5. El nombre es obligatorio; el envío crea una solicitud `requested` y la
   aceptación de la dueña crea la clienta, aparta stock y deja el pedido "Por
   cotizar". Rechazar elimina la solicitud sin tocar inventario.
5. Tests UI primero (patrón `App.test.tsx` / `primitives.test.tsx`), en rojo
   antes de la implementación: agente TESTS no lee la implementación, agente
   CÓDIGO no lee los tests (misma separación anti-bias que
   `public-product-detail`).
6. Unit para: builder del mensaje (intro-prefijo + líneas + folio + URL),
   señal/cap de stock, persistencia/corrupción de carrito y estado `requested`.
   El emulador cubre callable, idempotencia y límites.
7. `npm run typecheck && npm run test && npm run build` verdes; gate de
   design-system pasa (Sheet/TextField, nada crudo).
8. UI 100% español, mobile-first, sin dependencias nuevas.

## previewChecks

```json
[
  { "path": "/catalogo/olivia", "selector": "body", "text": "Olivia" }
]
```

(El flujo completo de carrito queda cubierto por tests UI + e2e en emulador.)

## Notas de implementación

- Un solo delivery: proyección + storefront + carrito (es una feature
  coherente; P1 demostró el ritmo de ~4 commits).
- TESTS primero (rojo registrado), luego CÓDIGO (proyección → UI → builder),
  cruza verde, `verify quick/final`, PR draft con `Delivery-ID`.
- Tocar `firestoreData.test.ts` exige actualizar los invariantes de proyección
  — es parte del cambio, no una flexibilización accidental.
- Tras deploy: desplegar `functions:submitPublicOrderRequest` e índices TTL y
  pulsar **Republicar catálogo** para refrescar proyecciones existentes.
