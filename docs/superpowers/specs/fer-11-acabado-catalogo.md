# FER-11 · Filtro por acabado y señal de agotado

## Alcance de esta entrega

- Enviar `finish` (acabado público ya disponible en el detalle) también en el resumen público que alimenta las tarjetas.
- Mostrar el acabado en cada tarjeta y permitir filtrar el catálogo por acabado cuando haya al menos dos acabados entre las piezas visibles. El filtro se combina con categoría, búsqueda, disponibilidad configurada y orden.
- No añade lecturas ni escrituras. El acabado es un campo ya presente en `products`; se copia al documento `publicCatalogs` existente. El aumento de almacenamiento y descarga es proporcional al largo de los acabados, sin imágenes ni servicios nuevos.
- La etiqueta `Agotado` se conserva en tarjetas y detalle. El resumen ya calcula `stockSignal` a partir de `quantityOnHand` y `lowStockAt`, sin exponer cantidades.

## Bloqueos documentados para la siguiente entrega

1. **Subcategorías:** Fer dio ejemplos de acabados (dorado/plateado), pero falta acordar si necesita una jerarquía independiente de categorías o si acabado cubre la primera necesidad. Esta entrega hace filtrable el campo de acabado sin convertirlo en subcategoría ni cambiar URLs.
2. **Origen de “Agotado”:** el catálogo considera agotado si `availability` está explícitamente en `sold_out` o si `stockSignal` indica cero existencias. Falta confirmar con Fer cuál manda si discrepan y si el agotado manual se usa para pausas temporales. Se conserva el comportamiento existente hasta confirmarlo.

## Casos comprobables

- Una categoría con piezas doradas y plateadas permite elegir un acabado y limita los resultados sin salir de la categoría.
- Si hay cero o un acabado disponible, no aparece un selector inútil.
- El acabado también se encuentra con búsqueda y se lee en la tarjeta.
- Las piezas agotadas conservan su etiqueta y las cantidades exactas no se exponen.
- El modo sin acabado y las proyecciones anteriores siguen funcionando.
