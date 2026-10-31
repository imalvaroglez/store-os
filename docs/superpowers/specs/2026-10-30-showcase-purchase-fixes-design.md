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

Esta primera etapa conserva el cálculo del proveedor y no reparte todavía
sus ajustes o gastos entre piezas. Esa limitación debe seguir visible hasta
completar la etapa de inventario, sin aparentar un costo completo calculado.

## Decisiones confirmadas por Álvaro

1. Una compra por viaje puede agrupar tickets de proveedores distintos.
2. El costo del inventario será el costo completo de la última compra, sin
   promediarlo con las existencias anteriores.
3. El nivel de precio de una clienta se elige una vez en su ficha; los pedidos
   lo aplican automáticamente. Marcar Emprendedora no asigna Iconic por sí solo.

El reparto por cantidad de piezas debe conservar exactamente el gasto
original. Ejemplos de aceptación de la etapa futura: $44 entre 70 piezas y
$150 entre 100 piezas. La implementación debe conservar el costo original,
explicar el gasto asignado, evitar duplicación y actualizar inventario una
sola vez al recibir. Compras recibidas anteriores no se recalculan.

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
- La primera etapa usa datos ya cargados y la escritura de compra existente;
  buscar no añade lecturas cloud. No añade servicios ni infraestructura con
  costo. Antes de implementar inventario se documentará el consumo de sus
  operaciones según las decisiones cerradas.

Fuentes: [notas de Compras](../../purchase-feedback-2026-10-30.md) y
[showcase](../../showcase-feedback-2026-10-30.md).
