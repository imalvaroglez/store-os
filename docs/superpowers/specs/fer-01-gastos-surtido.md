# FER-01: gastos de surtido en la compra

## Objetivo

Fer registra la mercancía y los gastos asociados a surtir en la misma compra, y puede consultar ambos importes al volver a abrirla. El envío incluido en el documento del proveedor sigue en el campo Envío existente. Los gastos externos se registran aparte como traslado para surtir u otro gasto, con descripción e importe en pesos y centavos.

## Comportamiento

- Una compra admite varios gastos externos. Se pueden agregar, editar y quitar mientras sea borrador; una compra recibida se muestra de solo lectura.
- Cada gasto guardado requiere descripción e importe. Un importe de $0 es válido si se escribe expresamente; un campo vacío no se convierte en cero al guardar.
- El total del documento y su conciliación conservan sus reglas anteriores; el desglose muestra además la suma de gastos y el total pagado al proveedor más esos gastos. Ejemplo: mercancía $100, envío $10, traslado $44.25: documento $110 y total con gastos $154.25.
- Los gastos no se distribuyen entre piezas ni se incorporan al costo del inventario. No se registran entregas a clientas aquí. Las reglas de reparto, gastos tardíos y corrección de compras recibidas requieren una entrega posterior.
- Compras anteriores sin gastos se leen con total de gastos $0. El dato permanece privado dentro del documento de la compra de su tienda y no se incorpora al catálogo público.

## Ambientes y consumo

Sin colecciones, consultas, servicios ni escrituras adicionales: los gastos viajan en la escritura existente de la compra. Se mantienen las reglas actuales de aislamiento y de inmutabilidad tras recepción. La validación automatizada usa únicamente `store-os-demo` en emuladores locales. Preview/Development corresponde a `store-os-dev`; producción corresponde a `store-os-f7cf8` y no se usa para pruebas. La carga de suscripciones existente y el consumo real total siguen sujetos a la revisión de cuota antes de liberar.

## Aceptación

Capturar y guardar varios gastos, impedir el guardado de un gasto incompleto, reabrir la compra, comprobar el documento del proveedor y los gastos por separado y verificar $0.10 + $0.20 = $0.30. Confirmar visualización en móvil y escritorio, compras anteriores y bloqueo de edición tras recepción. Contrastar el flujo con Fer antes de aplicarlo a operaciones reales.
