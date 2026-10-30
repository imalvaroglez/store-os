# FER-12 · Bloqueo de diseño para variantes

## Evidencia en el código actual

- Cada registro `Product` es una pieza inventariable con su propio `id`, `sku`, `quantityOnHand`, precios e imágenes.
- `finish` describe un atributo público de texto; no representa una opción seleccionable ni lleva existencia propia.
- La solicitud habla de un mismo diseño en dorado y plateado, con foto, disponibilidad y precio correctos al elegir. No define si esas opciones comparten inventario o se venden como piezas distintas.

## Bloqueo

No modelar variantes todavía. Compartir o separar existencias cambia qué puede pedir la clienta y qué descuenta Fer. Inventar esa regla puede vender una opción agotada o mostrar un precio incorrecto. La entrevista y el backlog dejan pendiente definir “diseño vs producto”, existencia y precio por variante.

## Decisiones que debe confirmar Fer

1. ¿Dorado y plateado son opciones de un mismo diseño, o productos independientes que solo se parecen?
2. ¿Cada opción tiene su propio SKU, cantidad disponible, precio y foto? Indicar qué campos pueden compartirse.
3. Si una opción está agotada, ¿se muestra deshabilitada, permite preguntar por ella o se oculta?
4. ¿El carrito debe registrar la opción elegida como una línea diferente, aunque sea el mismo diseño?
5. ¿Las piezas ya capturadas con `finish` se mantienen como productos independientes o deben convertirse en opciones de un diseño?

## Criterio para continuar

Con esas respuestas se puede comparar dos modelos:

- **Productos separados:** cada color conserva la forma actual de inventario, SKU, precio e imagen. Menor cambio y cada ficha tiene su propia URL.
- **Diseño con variantes:** el diseño agrupa opciones estables; cada opción debe tener identidad y reglas acordadas para existencia, precio, foto y solicitud. Cambia el modelo del catálogo y requiere plan de migración.

No se elige por adelantado uno de los modelos. La exploración de catálogo y el filtro por acabado de FER-11 siguen funcionando sin variantes.

## Restricciones

- No crear una nueva colección, servicio externo ni regla de reserva en línea antes de definir el modelo.
- Mantener los cambios de catálogo en la proyección pública existente y medir sus escrituras por opción antes de liberar.
- Sin migración ni escrituras a `store-os-dev` o producción en este trabajo.
