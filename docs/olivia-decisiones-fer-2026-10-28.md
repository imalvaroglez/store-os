# Olivia — Paquete de decisiones para Fer (D01–D15)

**Fecha:** 2026-10-28 · **Estado:** listo para sesión con Fer · **E0 del plan técnico.**
Companion del [reporte del ensayo del Excel](excel-trial-2026-10-28.md) y del
[análisis documental del Excel](fer-excel-analysis-2026-10-28.md).

Regla del documento: nada de lo marcado ⏳ se implementa sin respuesta del negocio. Las
recomendaciones son técnicas y siempre traen el trade-off. Lo ya confirmado no se reabre.

---

## Ya resuelto (no se reabre)

| ID | Decisión | Resolución |
|---|---|---|
| D06 | Porcentajes de distribución | **20% inversionista / 50% Fernanda / 30% fondo Olivia**, sobre ganancia (confirmado por Álvaro; las fórmulas del Excel de ventas lo usan en 9 filas × 3 columnas). El 15/50/35 de la hoja Inventario queda como hallazgo histórico. |
| D05a | Naturaleza del 20% al inversionista | **Pago de la inversión recibida** (no participación indefinida). Lo que falta está abajo. |
| D13 | Precios en catálogo público | **Se mantienen los 3 niveles publicados** (decisión comercial de agosto, confirmada por Álvaro en esta sesión). Revisión futura pendiente; el foco es la vigencia del nivel (D03). |
| — | Nombre del segundo nivel | **Girly** (el Excel lo usa en encabezados; «Gibly» fue error de transcripción). Falta la regla de obtención (D01). |

---

## D01 · Regla de obtención de Girly

**Pregunta:** ¿cómo obtiene una clienta el nivel Girly? ¿Se asigna manualmente, por volumen
de compra, o es simplemente el precio mayorista?

- **Opciones:** (a) asignación manual de Fer; (b) regla automática por piezas/monto;
  (c) Girly = precio mayorista público, sin asignación.
- **Recomendación:** (a) para V1 — el modelo `Customer.assignedTierId` ya lo soporta sin
  reglas adicionales; una regla automática se puede añadir después sin migración.
- **La necesita:** E2 (ficha de clienta). **La responde:** Fer.

## D02 · Base del umbral Iconic

**Pregunta:** ¿qué total se compara con $1,000 para activar Iconic — y qué pasa a
exactamente $1,000?

- **Contexto:** la regla del backlog dice «supera» (estricto `>`). El carrito público hoy
  evalúa el mínimo al precio **del propio nivel** y acepta la igualdad — es informativo y
  distinto; no se reutiliza.
- **Opciones:** (a) suma a precio Regular; (b) suma a precio Girly; (c) total pagado.
- **Recomendación:** (a) precio Regular — evita el ciclo «el descuento me baja del umbral»
  y es la referencia que todas las clientas ven.
- **La necesita:** E10. **La responde:** Fer.

## D03 · Vigencia y renovación de Iconic (foco confirmado por Álvaro)

**Pregunta:** ¿qué operación válida activa/renueva los 30 días (pedido creado, aprobado,
entregado, pagado)? ¿Y una compra posterior al vencimiento?

- **Recomendación:** renovar con **pedido entregado** (no meramente creado) y reactivación
  desde cero tras vencer (sin retroactividad). El aviso 7-días-antes se calcula sobre la
  vigencia, no sobre el mes calendario.
- **La necesita:** E10. **La responde:** Fer.

## D04 · Fecha definitoria del mes financiero

**Pregunta:** ¿la venta pertenece al mes por fecha de pedido, entrega o cobro? ¿Se muestran
vistas de devengo y efectivo?

- **Contexto:** el Excel calcula reparto en ventas NO PAGADO (hallazgo O2 del ensayo) — hoy
  la hoja reparte dinero no cobrado.
- **Recomendación:** dos vistas siempre: ventas por fecha de pedido (devengo) y cobros por
  fecha de pago (efectivo). La base distribuible se define explícitamente (ver D05b).
- **La necesita:** E4 (cobros con mes), E7. **La responde:** Fer (± asesor contable).

## D05b · Saldo del préstamo del inversionista (reformulado)

**Pregunta:** del 20% que paga la inversión — ¿cuál es el saldo pendiente, hay plazo/límite,
cómo se trata un mes con pérdida, y qué pasa al liquidarlo?

- **Contexto:** la naturaleza ya está confirmada (pago de la inversión); falta el lado
  aritmético: ¿el 20% es de la ganancia hasta recuperar X pesos, o por tiempo indefinido?
- **Recomendación:** modelar `payoutPolicies` con saldo inicial y reglas de aplicación;
  los meses con pérdida no generan pago negativo (se acumulan como pendiente si se decide así).
- **La necesita:** E7. **La responde:** Álvaro + inversionista.

## D07 · Significado del Packing del inventario ($2.83)

**Pregunta:** ¿qué incluye el $2.83 por artículo del Inventario — y cómo se relaciona con el
$1 por pieza que ya captura la hoja de octubre?

- **Contexto del ensayo:** 21 filas tienen packing sin datos de compra; octubre ya usa
  $1/pieza en 28 filas. Son dos números distintos en dos hojas.
- **Opciones:** (a) $2.83 = costo de adquisición histórica (empaque del proveedor, ya dentro
  del costo); (b) $2.83 = estimación de gasto de venta; (c) mezcla de ambos.
- **Recomendación:** tratar $2.83 como parte del costo de adquisición (no duplicarlo con el
  $1/pieza de venta) hasta respuesta; el ensayo lo marca como incidencia I1.
- **La necesita:** E5. **La responde:** Fer.

## D08 · Política de valuación de inventario

**Pregunta:** cuando el mismo artículo se resurte a otro costo, ¿cómo se valúa lo vendido —
promedio ponderado, FIFO/lotes u otra?

- **Recomendación:** **promedio ponderado** — ya está implementado y probado
  (`weightedAverageCost`), es auditable y suficiente a este volumen. FIFO/lotes añade
  complejidad sin beneficio claro hoy. La representación guardará valor total + cantidad
  (no centavos unitarios) para no perder exactitud.
- **La necesita:** E5. **La responde:** Fer (± asesor).

## D09 · Estado de pedido que descuenta stock

**Pregunta:** ¿en qué estado se reserva/descuenta inventario? ¿Se permite sobreventa (encargo)?

- **Contexto actual:** hoy **cualquier pedido abierto reserva desde `asked`**, el stock puede
  quedar negativo (se muestra como «Faltan N piezas») y cancelar un entregado devuelve stock.
- **Recomendación:** mantener la reserva temprana (evita sobrevender entre dos sesiones) y
  hacer del negativo un estado explícito «encargo» visible; separar cancelación comercial de
  retorno físico en E6.
- **La necesita:** E6. **La responde:** Fer.

## D10 · Reparto de un viaje de entrega compartido

**Pregunta:** cuando un viaje cubre pedidos de varias clientas, ¿cómo se reparte el costo?

- **Opciones:** (a) por piezas de cada pedido; (b) por importe; (c) partes iguales;
  (d) manual siempre.
- **Recomendación:** (a) por piezas — misma base que el prorrateo de compras/empaque
  (una sola regla mental para Fer), con ajuste manual posible.
- **La necesita:** E7. **La responde:** Fer.

## D11 · Métrica y reglas del Top 3

**Pregunta:** ¿el ranking mide total de pedidos, total cobrado o neto de devoluciones?
¿Desempates? ¿Cancelaciones cuentan?

- **Contexto:** Store OS conoce las compras a Olivia, no las reventas de las emprendedoras
  (aclaración esencial del backlog: nombrar el ranking «mayor volumen de compras»).
- **Recomendación:** total **cobrado** en el mes (consistente con no premiar dinero no
  recibido), desempate por fecha del último cobro (quien cobró antes, gana).
- **La necesita:** E12. **La responde:** Fer.

## D12 · Canal de avisos «sin abrir la app» — investigación inicial (anexo)

**Pregunta:** ¿cómo recibe Fer los avisos (stock bajo, Iconic por vencer, ranking) sin abrir
Store OS, con costo cero?

**Hallazgos (2026-10):**
- WhatsApp Cloud API incluye ~1,000 **conversaciones de servicio** gratis/mes por número —
  pero «servicio» significa mensajes que responden a una clienta que escribió primero.
- Los avisos que Fer quiere son **iniciados por el negocio** → requieren plantillas
  (utility) **aprobadas por Meta y cobradas por mensaje** (tarifa regional, cents. MX).
  Desde octubre 2026 Meta también ajustó el cobro de service replies, aunque mantiene el
  bloque gratis.
- Migrar el número de WhatsApp de la tienda a la Cloud API exige verificación de Meta
  Business y cambia cómo se usa el número hoy (wa.me casual) — riesgo operativo.
- Alternativas gratuitas son no oficiales (CallMeBot y similares): frágiles y sin garantía;
  no recomendables para producción.

**Recomendación por etapas (ya en el plan):** V1 = centro de avisos in-app + mensaje
WhatsApp **copiable con un tap** (costo cero garantizado); el envío automático queda como
decisión de negocio: aceptar el costo por mensaje de plantilla utility cuando el volumen
lo justifique. **No se promete automatización sin prueba de costo.**

Fuentes de la investigación (octubre 2026): [WhatsApp Business API Pricing: Oct 2026 Changes](https://gradezilla.org/whatsapp-business-api-pricing),
[WhatsApp Cloud API: Setup & Cost Guide](https://chatarmin.com/en/blog/whatsapp-cloudapi),
[WhatsApp API Pricing 2026: 7 Providers Compared](https://atomchat.io/blog-post/whatsapp-business-api),
[WhatsApp API for Free (WATI)](https://www.wati.io/en/blog/whatsapp-api-for-free).

## Reglas de apertura de la migración (E0 → E4/E9)

1. **Fecha oficial:** ¿desde qué fecha Store OS es la fuente oficial de verdad y el Excel
   queda congelado como evidencia? (Sugerencia: el 1 del mes siguiente a la migración.)
2. **Stock de apertura:** las cantidades de la hoja Inventario ¿ya descuentan las ventas de
   las hojas de Ventas? ¿Se hace conteo físico para la apertura? (El ensayo no puede
   saberlo; la respuesta evita el doble descuento.)
3. **Saldos de apertura:** los NO PAGADO de octubre (4 filas) se registran como
   `opening_balance` **sin mes** — saldo heredado, nunca como cobro de un período.
4. **Abonos sin fecha:** ¿algún depósito histórico sin fecha conocida? Se registra como
   saldo heredado con la fecha de migración marcada como tal, no como cobro del mes.

## D14 · Deduplicación y conteo físico (migración)

**Pregunta:** nombres de clienta/producto que refieren a la misma entidad (el ensayo ya
encontró 1 par de productos duplicados y variantes de nombres de clientas): ¿decisión caso
por caso con Fer, o regla?

- **Recomendación:** el importador (E9) propone candidatos y Fer decide en lote durante la
  sesión de ensayo; nunca fusiona automáticamente.

## D15 · Permisos y correcciones

**Pregunta:** ¿quién puede corregir precios/costos/cierres, y qué operaciones requieren
registro obligatorio de motivo?

- **Recomendación:** Fer = operación completa (precios, costos, cobros); cierres mensuales
  solo el dueño (Álvaro) una vez congelados; todo cambio de nivel de clienta y todo ajuste
  de inventario dejan registro de quién/cuándo/por qué.

---

## Pendientes del PO (no de Fer)

- **Baseline de producto (E0-d):** medir con Fer un pedido representativo HOY — minutos de
  captura, precios corregidos a mano, re-escritura en WhatsApp. Se vuelve a medir tras E3.
- **Sesión de decisiones** con este documento.
