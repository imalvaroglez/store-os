# Correcciones del showcase y compras de inventario por viaje

Fecha: 30 de octubre de 2026. Meta: revisión en dev el sábado 31 de octubre
a las 08:00, zona America/Mexico_City.

## Alcance de la meta

Álvaro confirmó que la entrega incluye las correcciones de captura, interfaz
y claridad de precios por clienta, además de la compra de inventario por
viaje con varios tickets y el reparto de gastos por cantidad de piezas.
La entrega termina con draft PR, pruebas y CI en verde y Preview local
validada con Firebase dev; no incluye merge ni producción.

La meta completa sigue abierta hasta implementar las decisiones
de negocio confirmadas y validar el recorrido completo. La corrección de
captura descrita abajo es una primera etapa, no el cierre de la meta.

## Primera etapa: captura y vinculación

- Conservar el texto de los importes mientras se escribe, incluido el punto
  decimal temporal, y guardar números mediante `parseAmount`. Aplicar esto
  al costo de línea, descuento, envío, impuestos y total pagado.
- Identificar las líneas con un `lineId` estable, también al abrir compras
  antiguas que no lo tengan, para que quitar o filtrar otra línea no mueva
  la captura de un renglón a otro.
- Vincular un producto solo resuelve su identidad. Conserva el costo de la
  compra, incluso cero o un importe importado editado; no toma el costo
  anterior del producto ni interpreta automáticamente un importe del PDF.
- Buscar productos de la tienda activa por nombre o clave; resultados
  ordenados por nombre en español. Reutilizar `SearchSelect` y mantener
  creación de producto visible arriba, incluso sin coincidencias. Quitar
  el botón duplicado para crear un único producto; conservar la creación
  explícita en lote para dos o más líneas.
- Compras recibidas conservan los campos bloqueados. El buscador compartido
  añade soporte opcional para bloqueo y una acción superior, sin cambiar
  la selección por teclado de los demás formularios.
- Al recibir, reconstruir la identidad del producto desde el ID canónico del
  documento Firestore. Los documentos guardados por la aplicación no llevan
  `id` dentro de sus campos; no se debe marcar recibida una compra omitiendo
  por esa razón sus actualizaciones de inventario.
- Conservar la captura y confirmación actuales al importar PDF. Resolver
  importes unitarios o por línea continúa siendo una acción explícita.

## Interfaz y totales

El formulario se limita al ancho estándar `max-w-5xl`. Usar tokens del tema
para encabezado y filas, con tarjetas de captura hasta que haya ancho para
la tabla; cantidad, costo y quitar deben compartir una fila en móvil.

Cambiar “Mercancía (Σ líneas)” por “Subtotal de productos” y explicar los
ajustes del proveedor. El envío es cargo del proveedor; el transporte de
Fer es un gasto aparte. No duplicar impuestos o descuentos ya incluidos.
Dar nombres accesibles estables a los campos, separados de sus ayudas.

Cada ticket se compara con su propio total pagado, sin permitir que una
diferencia compense la de otro proveedor. En compras nuevas o borradores
actualizados, los importes deben cuadrar al centavo antes de recibir.

El resumen distingue productos, envío y ajustes de tickets, gastos del viaje
repartidos y costo completo de inventario. La barra de acciones muestra el
total de la compra con sus gastos. Las fechas de compra y su presentación
respetan el día de México; una fecha sin hora no retrocede al día anterior.

## Decisiones confirmadas por Álvaro

1. Una compra por viaje puede agrupar tickets de proveedores distintos.
2. El costo del inventario será el costo completo de la última compra, sin
   promediarlo con las existencias anteriores.
3. El nivel de precio de una clienta se elige una vez en su ficha; los pedidos
   lo aplican automáticamente. Marcar Emprendedora no asigna Iconic por sí solo.

El reparto por cantidad de piezas conserva exactamente el gasto
original. Ejemplos de aceptación: $44 entre 70 piezas y
$150 entre 100 piezas. La implementación debe conservar el costo original,
explicar el gasto asignado, evitar duplicación y actualizar inventario una
sola vez al recibir. Compras recibidas anteriores no se recalculan.

## Datos, reparto y recepción

- `Purchase.tickets` guarda tickets con ID, proveedor o nombre, folio, pago,
  ajustes y referencias privadas a PDF. `PurchaseLine.ticketId` relaciona
  cada renglón con su ticket; el nombre y fecha de la compra identifican el
  viaje. Agregar o importar otro ticket conserva los anteriores. Se detectan
  PDFs repetidos antes de volver a subirlos o procesarlos.
- `costingMethod: latest_purchase` identifica la regla nueva. La recepción
  conserva `costAllocations` por línea en centavos enteros: productos,
  ajustes del proveedor, gasto de surtido y total atribuido. Los importes del
  ticket no se reemplazan por esos cálculos.
- Envío: reparto por piezas del ticket correspondiente. Transporte y gastos
  marcados: por piezas de todo el viaje. Descuentos e impuestos adicionales:
  por valor de los productos del ticket; un descuento no supera sus productos.
  Esto evita generar costos negativos en una pieza barata.
- Los centavos sobrantes se asignan por mayor residuo con desempate estable
  por `lineId`, usando aritmética entera. El costo mostrado por unidad se
  redondea a dos decimales; el total atribuido conserva el gasto exacto.
- Transporte se incluye por defecto; los demás gastos solo si se marca
  “Repartir este gasto entre las piezas del viaje”. El total desembolsado
  sigue incluyendo los gastos registrados que no se incorporen a inventario.
- Última compra significa última compra recibida. Si el mismo producto
  aparece en varios tickets, se suma su costo dentro de ese viaje y se divide
  entre sus piezas; no se mezcla con el costo de las existencias anteriores.
  El pedido nuevo toma ese costo; pedidos guardados conservan su captura.
- La transacción relee compra, proveedores y productos canónicos, valida la
  tienda y actualiza productos y recepción de forma atómica e idempotente.
  La interfaz usa el resultado canónico, sin recalcular cantidades obsoletas.
  Las operaciones nuevas fallan explícitamente sin sesión/Firestore.
- Campos opcionales mantienen legibles las compras anteriores. Los borradores
  adoptan tickets y regla nueva al editar/guardar; las compras ya recibidas
  permanecen intactas y consultables. No se intenta reparar inventario pasado
  ni volver a recibir compras antiguas automáticamente.

La vigencia automática de Iconic por 30 días continúa fuera de esta entrega
mientras sus reglas sigan pendientes. No se incluyen remuneración de Fer,
consignación con Mari ni una migración de históricos.

## Validación y consumo

- Regresión de captura tecla por tecla, incluido `16.45`, y persistencia del
  número al guardar. Vinculación contra un producto con otro costo guardado.
- Búsqueda y creación disponibles sin coincidencias; búsqueda limitada a la
  tienda activa, compras recibidas bloqueadas y selección por teclado.
- E2E contra Auth/Firestore/Storage emulados con proyecto `store-os-dev`:
  capturar, vincular, guardar, reabrir y recibir, comprobando la cantidad
  canónica; revisar tema Paper, Lujo y Maximalista a 390 y 1280 px.
- Conservar recepción de 50 líneas, importes por revisar, creación por lote,
  gastos separados, idempotencia y rechazos de productos inexistentes o de
  otra tienda. Typecheck, suite unitaria, build y CI obligatorios.
- Buscar y editar usan datos ya cargados; guardar mantiene una escritura de
  compra. Recibir usa aproximadamente `2 + L + P + 2S` lecturas y `P + 1`
  escrituras, donde L son líneas, P productos distintos y S proveedores
  registrados distintos, sin contar la sincronización ya existente. Un viaje
  de 70 líneas/productos y 5 proveedores implica unas 152 lecturas y 71
  escrituras, dentro de 50K/20K diarios con el uso de esta tienda. El desglose
  se guarda en la misma compra, sin nuevas colecciones ni servicios.

Fuentes: [notas de Compras](../../purchase-feedback-2026-10-30.md) y
[showcase](../../showcase-feedback-2026-10-30.md).
