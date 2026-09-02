# ADR 0004 — Iconic como objetivo comercial

- **Estado:** Aceptado
- **Fecha:** 2026-09-01
- **Decisor:** Álvaro González (Product Owner)

## Decisión

Para Olivia, los tiers canónicos son `Regular` (`t_retail`), `Girly`
(`t_wholesale`) e `Iconic` (`t_reseller`). Iconic es el objetivo principal del
catálogo: se desbloquea cuando la suma de las cantidades por el precio Iconic
alcanza al menos $1,000 MXN, independientemente de Girly.

Regular sólo es la referencia matemática para explicar ahorros. Girly es un
escalón intermedio desde 5 piezas. Los mínimos se calculan con precios del
propio tier: 11 piezas a $90 suman $990 y no desbloquean Iconic; 12 piezas
suman $1,080 y sí lo desbloquean. Dos piezas caras también pueden desbloquearlo
sin cumplir el mínimo de Girly.

El carrito muestra un subtotal estimado del nivel aplicable, envío no incluido
y confirmación por WhatsApp. Sólo comunica ahorros sobre las piezas ya
seleccionadas; nunca promete el ahorro de productos futuros. El precio final y
la existencia los confirma la tienda por WhatsApp.

Los tiers siguen siendo editables por tienda. Si una tienda legacy/custom no
tiene `t_retail`, el motor usa como referencia defensiva el primer tier visible
con precios completos; no se agrega un campo nuevo al modelo. La selección del
nivel aplicable sigue el `order` de la tienda y requiere precio para todas las
líneas.

## Consecuencias

- Las tarjetas dan prioridad visual a Iconic y muestran Regular/Girly de forma
  compacta.
- `pricing.ts` es la única fuente del cálculo de subtotales, progreso y ahorro.
- El carrito es informativo: no cobra, no reserva inventario y no impone los
  mínimos en el cliente.
- Las tiendas legacy de precio único conservan su flujo actual.
