# FER-05 · Beneficio Iconic renovable — decisiones y diseño

Fecha: 2 de noviembre de 2026. Issue #130 (P2, `requiere-decision`).
Antecedente: `fer-iconic-ranking-blockers.md` registró los bloqueos; este
documento registra las decisiones adoptadas para poder implementar la vigencia
automática. Cada decisión está marcada **adoptada por autonomía del PO —
reversible**: son las respuestas más conservadoras posibles con los datos que
ya existen en el sistema, y el PO puede cambiarlas sin migración de datos.

> **Revisión del PO (2026-11-03, ronda regla por regla):** el umbral pasó a
> **≥ $1,000 exactos** (antes estrictamente mayor); el evento de activación es
> el **cobro** — un pedido activa Iconic al quedar LIQUIDADO (contraentrega: al
> recibir el dinero al entregar; cuotas: al liquidar), no al capturarse; y la
> renovación dentro de la vigencia acepta **cualquier pedido liquidado, sin
> monto mínimo**. La ventana sigue siendo móvil de 30 días desde la fecha del
> pedido que activa/renueva. Vigencia manual y Girly quedan como estaban.

## Reglas vigentes (implementadas)

1. **Umbral (bloqueo 1).** Un pedido con total **estrictamente mayor a $1,000
   MXN** (exacto en centavos, sobre las líneas congeladas del pedido —
   `orderTotals`) activa Iconic en ese mismo pedido. Se compara el total real
   del pedido, no el precio Regular ni el Iconic, y no se aplican descuentos
   adicionales: es el importe que la clienta paga. "Superar" excluye $1,000
   justo; $1,000.01 sí califica. *Adoptada por autonomía del PO — reversible*
   (el umbral es la constante `ICONIC_MIN_TOTAL`).
2. **Evento válido (bloqueo 2).** El evento es **capturar el pedido**: cuenta
   cualquier pedido no cancelado (`asked`, `quoted`, `confirmed`,
   `preparing`, `ready`, `delivered`), sin importar su cobro o entrega. Un
   pedido **cancelado nunca cuenta** (no activa, no renueva y, si se cancela
   después, la vigencia se recalcula sin él). No hay devoluciones en el
   sistema; quedan fuera. *Adoptada por autonomía del PO — reversible.*
3. **Renovación de 30 días (bloqueo 3).** Ventana móvil: la activación abre
   30 días contados desde la fecha **guardada** del pedido que la originó
   (`createdAt`, nunca inferida). Otro pedido calificado capturado dentro de
   la ventana la renueva: el nuevo vencimiento es **fecha del pedido que
   renueva + 30 días** (periodo móvil; no se apila sobre el vencimiento
   anterior ni se usa mes calendario). Tras vencer, el siguiente pedido
   calificado simplemente abre una ventana nueva (recuperación automática).
   Fechas y días restantes se calculan en horario de Ciudad de México
   (UTC-6 plano). *Adoptada por autonomía del PO — reversible.*
4. **Asignación manual, recuperación y Girly (bloqueo 4).** El estado del
   beneficio es **independiente del precio manual por clienta**
   (`assignedPriceTierId`, FER-04): nada lo modifica automáticamente y no se
   asigna el nivel Iconic por inferencia. Se agrega una vigencia **manual**
   opcional por clienta (`iconic.since` / `iconic.until`, fechas guardadas)
   editable en Clientes; la vigencia efectiva es la unión de la ventana
   automática y la manual (la automatización nunca quita lo otorgado a mano;
   vaciar ambas fechas la elimina de verdad en Firestore). Girly queda fuera:
   es un beneficio distinto (por piezas). *Adoptada por autonomía del PO —
   reversible.*
5. **Aviso externo (bloqueo 5).** **No hay canal externo.** El aviso previo es
   visual al abrir el panel: Inicio y Clientes muestran las clientas Iconic
   cuya vigencia vence dentro de la ventana de aviso (**7 días**, dato
   confirmado por Fer: "una semana antes"; constante `ICONIC_NOTICE_DAYS`).
   WhatsApp/email/push/SMS quedan como pendiente del PO y solo se comprometerán
   con una prueba de costo cero. *Adoptada por autonomía del PO — reversible.*

## Modelo de datos

- `Customer.iconic?: { since: string; until: string }` — vigencia manual
  (fechas ISO por día). Opcional; los documentos existentes no cambian.
- La ventana automática **no se persiste**: se deriva en memoria de los
  pedidos ya sincronizados (`src/lib/iconic.ts`), por tienda y por clienta.

## Costo Firestore (comprobado dentro del free tier)

- **Lecturas nuevas: 0.** La derivación usa los pedidos y clientas ya cargados
  en el estado sincronizado; no hay listeners ni consultas nuevas.
- **Escrituras nuevas:** solo la vigencia manual — 1 escritura del documento
  de clienta por cada otorgamiento o edición manual (el mismo costo que
  cualquier edición de clienta hoy). Activación, renovación y vencimiento
  automáticos: **0 escrituras**.
- Sin Cloud Functions, sin Storage, sin servicios externos.

## Fuera de alcance (explícito)

- Canal de aviso externo (pendiente del PO, sujeto a costo cero).
- Aplicación automática del nivel de precio Iconic en pedidos (FER-04 se
  mantiene manual; esta entrega no reabre el precio por clienta).
- Histórico de clientas anterior a Store OS: si Fer quiere reflejar vigencias
  ganadas fuera del sistema, usa la vigencia manual por clienta. No se
  inventan pedidos históricos.
