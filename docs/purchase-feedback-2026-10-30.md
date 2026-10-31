# Compras: notas de uso y compra por viaje

Fecha: 30 de octubre de 2026. Fuente: reporte y dictado de Álvaro al capturar
una compra de Olivia; incluye una captura de la pantalla Editar compra.

**Estado: nota de backlog, pendiente de priorizar y diseñar.** Álvaro pidió
expresamente registrar estas necesidades, sin implementarlas en este momento.
Las ideas de interfaz y modelo descritas aquí no constituyen una spec aprobada.

## Problemas reportados en la captura

Entrada de backlog: `purchase-entry-polish`.

- **Decimales:** al escribir el costo de compra en la primera línea no se
  puede completar `16.45`. Debe poder capturarse el importe tecla por tecla.
- **Tema y acabado visual:** la franja blanca de encabezados de la tabla rompe
  con el tema. Revisar la pantalla completa para que títulos, fondos,
  alineación y controles se sientan terminados y coherentes con el sistema
  de diseño, en móvil y escritorio.
- **Buscar para vincular:** la lista de productos sin orden dificulta
  encontrarlos. Se pide buscar escribiendo y elegir entre coincidencias,
  como al crear un pedido; presentar resultados con un orden comprensible.
- **Crear producto:** la opción debe estar al principio y ser fácil de
  encontrar. Resolver la duplicidad percibida entre la opción del selector y
  el botón adicional, aclarando si existe una acción distinta de creación
  por lote.
- **Conservar el costo capturado:** vincular un producto existente reemplaza
  el costo ya escrito. La vinculación debe conservar el importe de esa
  compra; cualquier uso de un costo anterior debe ser explícito.
- **Totales comprensibles:** “Mercancía (Σ líneas)”, descuento y envío no
  explican suficientemente qué representan ni cómo se relacionan con lo que
  Fer necesita. Revisar las etiquetas y el desglose; distinguir productos,
  ajustes del proveedor y gastos adicionales, sin contabilizarlos dos veces.

## Unidad de registro propuesta: una compra puede tener varios tickets

Entrada de backlog: `purchase-trip-multiple-tickets`; relacionada con FER-01.

Fer fue al centro joyero a surtirse y realizó cuatro o cinco compras al mismo
proveedor, cada una con su ticket y folio. Para Álvaro, el conjunto debe poder
registrarse como **una compra de inventario del viaje**, identificable por
fecha y un nombre como “Centro joyero — 30/10/2026”, conservando la relación
con cada ticket y su folio.

El transporte de ida y vuelta se registra una sola vez para el conjunto, aunque
haya varios tickets. El nivel de registro deseado es la compra del viaje,
no una compra independiente por cada ticket con el transporte repetido.

La estructura de datos, la captura o importación de varios comprobantes y el
comportamiento con compras anteriores quedan para diseño. No se ha definido
si una misma compra podrá agrupar también tickets de proveedores distintos.

## Costo por pieza con gastos de adquisición

Ampliación de `fer-cost-allocation` (FER-02), relacionada con FER-03 y las
historias OLI-001/002/003 del diagnóstico técnico.

La propuesta para esta compra es repartir los gastos de adquisición **entre
la cantidad total de piezas compradas**, considerando todos sus tickets;
no entre el número de líneas ni entre el número de tickets. El costo completo
de cada pieza incorpora su costo de compra y la parte del gasto que le toca,
para que ese costo pueda usarse después al registrar una venta.

Ejemplos relatados, no tarifas fijas:

- **Compra presencial:** 70 piezas y $44 de transporte. El dictado corrigió
  la cantidad inicial a 70 piezas y precisó el transporte en $44.
  `$44 / 70 = $0.628571…` por pieza, aproximadamente $0.63; una pieza de
  $10 tendría un costo ilustrativo de $10.63.
- **Compra en línea:** 100 piezas y $150 de envío; corresponden $1.50 extra
  por pieza.

El reparto debe conservar exactamente el gasto original. Redondear $0.63 y
multiplicarlo por 70 produce $44.10; truncar a $0.62 produce $43.40. La forma
de guardar la precisión y repartir centavos sobrantes queda pendiente de
diseño, sin convertir el ejemplo redondeado en una regla aprobada.

También queda por definir cómo conservar el costo de compra original y su
desglose, cómo usar el costo completo al recibir inventario y vender, qué
ocurre con existencias de compras anteriores y con correcciones posteriores.
El envío del proveedor y los gastos adicionales deben revisarse juntos para
evitar distribuir el mismo gasto dos veces.

FER-01 ya contempla registrar gastos separados; su spec no incluye
prorratearlos ni cambiar el costo unitario. Esta nota amplía el descubrimiento
para una entrega futura, sin modificar retroactivamente ese alcance.

## Contexto que se conserva para después

- En el mismo viaje Fer compró exhibidores para dejar joyería a la venta en
  el negocio de Mari, junto con precios identificables, y hacer cuentas
  posteriormente. Se conserva como contexto; esta petición se enfoca en la
  compra de inventario, sin definir aún exhibidores, consignación ni
  liquidaciones con Mari. Tampoco se decide cómo repartir un viaje mixto.
- El tiempo y esfuerzo de Fer, aproximadamente medio día, y su posible
  remuneración se dejan para otra conversación. El ejemplo actual incluye
  únicamente el transporte como gasto adicional.
- Se mencionaron una pantalla de confirmación y un historial de costos o
  precios como posibles ideas. No se solicita desarrollarlas ahora; conservar
  el costo escrito al vincular es la necesidad inmediata reportada.

Referencias: [backlog de Fer](fer-backlog-2026-10-28.md),
[diagnóstico técnico](olivia-technical-diagnostic-2026-10-28.md) y
[decisiones financieras pendientes](superpowers/specs/fer-financial-blockers.md).
