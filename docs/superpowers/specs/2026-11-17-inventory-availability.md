# Disponibilidad pública determinada por inventario

Decisión del PO, 17-nov-2026, issue #489: «Que el inventario determine la disponibilidad; para retirarlo temporalmente usamos Borrador / no visible».

En tiendas con inventario, la señal calculada de existencias determina Disponible, Pocas piezas y Agotado. Una marca heredada `availability=sold_out` no puede contradecir una señal de existencias presente. Cero/negativo conserva Agotado; cada color conserva su propia disponibilidad. Un documento antiguo sin señal conserva la interpretación conservadora existente hasta publicarse con señal; no se inventan existencias. Las tiendas bajo pedido conservan el control manual.

El editor no ofrece una disponibilidad manual contradictoria a quien opera inventario. Publicación, fichas, filtros, selección y WhatsApp deben compartir la regla. Borrador/no visible sigue siendo la opción para retirar temporalmente una pieza. Los campos heredados pueden permanecer en datos privados sin gobernar la disponibilidad de inventario; no se requiere migración ni se alteran cantidades.

Se descartó conservar «Agotado» como pausa independiente en inventario porque reproduce la contradicción confirmada; añadir una nueva pausa sería trabajo que el PO no pidió. La señal pública existente permite aplicar la regla a documentos ya publicados sin lecturas extra ni reparación masiva. Las proyecciones posteriores se normalizan también para clientes antiguos. No se agregan servicios ni consumo por consulta.

Validación: marca heredada con existencias disponibles/pocas/cero/negativas, tiendas bajo pedido, colores, ocultar agotados, detalle y datos estructurados, carrito y edición administrativa; Preview local con datos sintéticos en móvil/escritorio y dos revisiones independientes. Sin lectura/escritura de producción. PR #491 permanece en borrador hasta revisión expresa del PO.
