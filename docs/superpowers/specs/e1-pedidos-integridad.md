# Integridad de pedidos y captura recuperable

Los pedidos usan revisión numérica y operación identificada para evitar reservas duplicadas y rechazar ediciones anteriores. El pedido y los cambios de existencias se calculan con los documentos leídos en una transacción; la cancelación por borrado requiere la revisión mostrada y devuelve la reserva canónica. Los pedidos anteriores parten de revisión cero.

El editor conserva su revisión, identidad y operación al recuperar una captura local. Si existe una captura de una versión diferente, se muestra para consulta antes de descartarla. La persistencia de borradores se limita al usuario y tienda actuales, y los errores de almacenamiento se comunican a la persona operadora. Las líneas antiguas de pedidos y compras reciben identidades deterministas en memoria; no se reescriben compras recibidas ni se guardan pedidos de fondo durante la migración.

Las reglas permiten consultar la ausencia de un pedido o producto a una sesión autenticada; los documentos existentes siguen sujetos a la pertenencia de tienda y las listas mantienen sus restricciones. CI publica primero reglas compatibles y después el cliente.

## Consumo y límites

La captura y los borradores no hacen operaciones cloud. Para un pedido con P productos afectados, cada intento de transacción lee hasta 1 pedido y P productos y escribe 1 pedido y hasta P productos; los reintentos y las reglas generan consumo adicional. En 100 guardados diarios de 50 productos son hasta 5,100 lecturas y 5,100 escrituras directas, más accesos de reglas y reintentos. La suscripción existente recarga colecciones completas al cambiar datos, así que el consumo total depende del tamaño real de las tiendas y requiere medición antes de liberar. No se crea ningún servicio, índice nuevo ni almacenamiento externo.

## Validación

Pruebas del emulador: dos órdenes simultáneas, doble envío, reintento, edición y borrado obsoletos, aislamiento y pedido de 50 productos. La interfaz prueba conservación, descarte, conflicto y reintento de borrador. El build local y los recorridos móvil y escritorio complementan las pruebas de reglas.
