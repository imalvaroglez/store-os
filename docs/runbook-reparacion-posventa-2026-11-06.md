# Runbook — verificación y reparación de datos previos (posventa y suministros)

Corrige las consecuencias de datos escritos con la semántica ANTERIOR a los PRs
de corrección (`fix/posventa-revision-codex` y `fix/suministros-exactos`).
**Ejecución exclusivamente humana y autorizada, por proyecto y ambiente.**
Ningún agente ejecuta estos pasos; tampoco se modifican datos productivos sin
aprobación explícita del PO.

## Contexto

Las features de posventa (#203) y suministros (#184) se liberaron en 1.7.0 y
1.8.0 con dos defectos de dinero ya corregidos en código:

1. **Suministros**: el costo por unidad redondeaba hacia ARRIBA por consumo
   (techo), de modo que consumir todo el stash podía cargar MÁS que el
   desembolso (100 bolsas por $15.50 → $16.00). El fix usa piso + residuo
   repartido una sola vez; **los cargos ya persistidos en `saleExpenses` con
   el redondeo viejo NO se recalculan automáticamente**.
2. **Posventa**: (a) el reembolso comprometía el precio histórico completo de
   la pieza sin conciliar contra lo realmente cubierto; (b) "Reparado"
   devolvía la pieza a inventario vendible sin autorización explícita.

## Paso 0 — Alcance del impacto (solo lectura)

Para cada ambiente (`store-os-dev` permitido a agentes; producción solo humano):

```js
// Firestore (consola o CLI con permisos), colección `expenses`:
// Suministros con consumos previos al fix (candidatos a sobre-cargo).
db.collection("expenses").where("category", "==", "supplies").get()
  → filtrar docs con supply.consumptions.length > 0
// Por cada uno: Σ (supply.consumptions[].quantity) × techo viejo vs amount.
// Diferencia = sobre-cargo acumulado en pedidos (saleExpenses sup_*).

// Colección `orders`: pedidos con incidents cuya resolución kind=="refund"
// y refundUnitPriceCents > 0 (modelo viejo) o con eventos "repaired".
db.collection("orders").where(...)...  // scan de docs con campo incidents
```

En `store-os-dev` se espera SOLO datos sintéticos de recorridos QA (tiendas
"QA Posventa *", "QA Gastos *"); verificar y documentar antes de cualquier
escritura. En producción, la vigencia de 1.7.0/1.8.0 es de horas y Olivia no
reporta uso de posventa; el PO confirma con Fer antes de actuar.

## Paso 1 — Suministros sobre-cargados (si aplica)

Para cada `saleExpenses` de tipo `sup_*` cuyo `amountCents` exceda el monto
exacto (q × piso + residuo):

1. Calcular el cargo correcto con la fórmula nueva (o re-ejecutar el consumo
   en un entorno de pruebas hasta validar el monto).
2. Editar el `amountCents` del cargo en el pedido (evidencia: anotar el
   valor anterior en `description` o en un note del gasto de origen).
3. No hay compensación automática de la ganancia: el `orderProfitBreakdown`
   se recalcula con el cargo corregido al leer.

## Paso 2 — Reembolsos sobre-comprometidos (modelo viejo)

Resoluciones `refund` con `refundUnitPriceCents` (legacy) donde el reembolso
conciliado real (fórmula nueva) sea menor:

1. Recomputar con `reconcileIncidentMoney` (o manual: cubierto − venta
   efectiva, con tope de la pieza).
2. Si ya se ejecutó el reembolso por el monto viejo: registrar la diferencia
   como crédito aceptado o ajuste de cobro (`adjustment` con signo, vía la
   hoja de Cobros del pedido) — decisión de Fer.
3. Si está pendiente: actualizar `refundOwedCents` al monto conciliado y
   dejar `refundUnitPriceCents` como evidencia histórica.

## Paso 3 — Piezas "reparadas" liberadas sin autorización

Eventos `repaired` previos al fix pudieron sumar existencias vendibles:

```js
// Pedidos con incidents[].events[].kind == "repaired" (previo al fix)
// y producto con quantityQuarantined == 0 tras el evento.
```

Para cada pieza: Fer decide — mantenerla vendible (no-op, documentar) o
retirarla (restar 1 de `quantityOnHand`, sumar 1 a `quantityQuarantined`, y
añadir un evento `returned_to_sale` invertido NO existe: documentar en notas
del pedido la corrección manual).

## Paso 4 — Registro

Dejar evidencia en la issue correspondiente (#203/#184): qué documentos se
tocaron, montos antes/después, quién autorizó y cuándo. Este runbook no
modifica historial; toda escritura queda en los documentos vivos.
