# Olivia: necesidades de Fer y backlog de trabajo

Fecha: 28 de octubre de 2026. Fuente: entrevista dictada por Álvaro y Fer en
este chat. Fer es la dueña y operadora principal de Olivia.

Estado: descubrimiento terminado; prioridades propuestas por Codex, pendientes
de acordar con Álvaro. Este documento no aprueba reglas pendientes ni autoriza
implementar todas las capacidades. Diseñaremos cada entrega antes de que Claude
Code implemente, con supervisión y revisión de Codex.

## Qué cambió en el negocio

Olivia pasó de 2–3 emprendedoras algo activas a 7 bastante activas. Hay pedidos
de 40–50 piezas. La mayoría llega fuera del catálogo y Fer los captura
manualmente, escribe el desglose en WhatsApp y calcula costos y repartos en
Excel. El volumen aumenta el tiempo de operación y el riesgo de cobrar mal.

El objetivo es registrar cada operación una vez y reutilizar sus datos para el
precio, el ticket, el inventario, los costos y el corte mensual. La herramienta
debe funcionar bien en celular y computadora.

## Hechos y reglas relatadas

- Surtir presencialmente requiere cuatro camiones de $11: $44 en total. Al
  principio se mencionó un aproximado de $42–$44; el desglose fue $44.
- El envío del proveedor se mencionó como $149 y después $150. Son ejemplos,
  no una tarifa fija que deba quedar en el sistema.
- La entrega en Santa Fe puede agregar $22 de transporte de ida y vuelta.
- Empaque individual: $1 por pieza. Bolsa del conjunto: $1 repartido entre las
  piezas incluidas. Ejemplo: una bolsa con 30 piezas distribuye ese peso entre
  las 30; falta acordar el manejo de los centavos sobrantes.
- El ejemplo confirmado de compra es $44 de transporte / 100 piezas = $0.44
  extra por pieza. La regla general de reparto aún requiere definición.
- Los tipos de precio mencionados son Regular, Gibly e Iconic. Confirmar la
  escritura de Gibly antes de cambiar etiquetas.
- Un primer pedido que supere $1,000 da acceso a Iconic en ese mismo pedido.
  El beneficio se mantiene con un pedido mensual. Falta precisar la base del
  umbral y qué evento cuenta como compra.
- Fer pide un aviso una semana antes del vencimiento Iconic, en su celular,
  sin abrir la aplicación. Ejemplo: compra el 28 de septiembre, renovación el
  28 de octubre, aviso el 21 de octubre. El canal de este aviso no se confirmó.
- Para existencias bajas, Fer sí prefiere WhatsApp. Una o cero piezas fueron
  ejemplos, no un umbral universal aprobado.
- El Excel descuenta costos y divide la ganancia entre Fer, Olivia y el
  inversionista con porcentajes existentes que todavía no conocemos.
- Los cortes abarcan del primero al último día de cada mes. Una venta del
  primero de octubre no pertenece a septiembre.

## Backlog consolidado

Los 16 candidatos de la conversación se conservan con IDs estables. P1 significa
primera prioridad propuesta; P2, siguiente grupo; P3, evolución posterior.
No son fechas comprometidas. Los criterios describen resultados para revisar;
las decisiones abiertas se resuelven en diseño antes de implementar.

En `docs/backlog.json`, `discoveryId` vincula cada entrada con FER-01–16 y
`proposedPriority` conserva P1/P2/P3. La prioridad numérica histórica no se
reordenó globalmente: las nuevas entradas se anexan a esa lista. Todas las
entradas de este ciclo quedan en `needs-spec`. Se reutiliza `receipts` para
FER-08 y se cambia su estado a `needs-spec` porque su spec debe actualizarse
con la base actual y lo pedido en esta entrevista. `relatedItems` identifica
antecedentes para revisar, no dependencias obligatorias de implementación.

| ID | Prioridad | Necesidad / primera entrega propuesta | Resultado comprobable | Dependencias y decisiones |
| --- | --- | --- | --- | --- |
| FER-01 | P1 | Capturar el ticket de compra con productos, cantidades y gastos de surtido. | Fer registra la compra y sus gastos juntos, con desglose y total verificables. | Ampliar Compras; distinguir envío, traslado para surtir y entrega a clienta. No implica leer fotos o implementar OCR. |
| FER-02 | P1 | Distribuir gastos compartidos y empaques entre las piezas. | El reparto conserva exactamente el gasto original; soporta el ejemplo de $44 / 100 piezas y la bolsa de $1 / 30 piezas. | FER-01; definir base de reparto, precisión, sobrantes, gastos tardíos y nivel compra/pedido/entrega. Evitar contar el mismo gasto dos veces. |
| FER-03 | P1 | Ver costo completo y ganancia de una venta. | Un desglose permite reconstruir venta menos producto y gastos asignados, con resultado contrastable con Excel. | FER-02 y revisión del Excel; distinguir ganancia de efectivo cobrado, costos de compra y costos de entrega. Definir devoluciones y costo histórico. |
| FER-04 | P1 | Guardar el tipo de precio de la clienta y aplicarlo al pedido. | Al elegir a Sofía con Iconic, las líneas toman su precio Iconic sin seleccionarlo una por una. | Reutilizar tipos por tienda; definir cambio de clienta con líneas existentes, precios faltantes y ajustes manuales. Separado de la renovación automática. |
| FER-05 | P2 | Obtener y renovar Iconic; avisar antes de vencer. | Con reglas acordadas, el pedido que cumple el umbral recibe Iconic y Fer ve vigencia y próximo vencimiento; el aviso llega sin abrir la app. | FER-04; definir umbral, evento, vigencia, pérdida y recuperación. Estudio del canal externo y costo cero antes de comprometer la notificación. Se puede dividir reglas y avisos en entregas distintas. |
| FER-06 | P1 | Insertar nuevas líneas arriba al capturar pedidos. | En un pedido de 50 piezas, Agregar deja la nueva línea visible arriba; las anteriores conservan sus datos y totales. | Cambio pequeño independiente; revisar ubicación del botón, foco y teclado en móvil. |
| FER-07 | P1 | Agrupar las líneas del pedido por categoría. | Fer compara anillos, pulseras y otras categorías con la solicitud y detecta faltantes sin recorrer una lista mezclada. | Acordar convivencia con FER-06: captura reciente y revisión por categoría; productos sin categoría o con varias. No imponer una solución todavía. |
| FER-08 | P1 | Generar un ticket digital del pedido para compartir. | Cantidad, producto, precio unitario, subtotal y total coinciden con el pedido; el desglose está agrupado por categoría y Fer puede enviarlo sin reescribirlo. | Reutiliza `receipts`; elegir texto, PDF o etapas. Definir cotización vs recibo de pago, saldo, edición y categoría histórica. Envío manual por Fer, sin mensajería automática implícita. |
| FER-09 | P2 | Avisar existencias bajas o agotadas para planear compras. | Fer identifica qué reponer; los avisos acordados no se repiten por cada visita y respetan reposiciones y cambios de stock. | Umbral por producto, momento de descuento, frecuencia y canal. WhatsApp es la preferencia; viabilidad sin costo pendiente. No asumir que aviso equivale a ocultar el producto. |
| FER-10 | P2 | Portada fotográfica y entradas visuales por categoría. | La entrada al catálogo presenta imágenes y categorías; al elegir una se muestran sus productos. | Banner y rutas de categoría ya tienen soporte. Definir fotos, contenido y navegación de regreso; validar diferencia entre código y catálogo observado por Fer. |
| FER-11 | P2 | Subcategorías y señal de agotado clara. | La clienta puede encontrar, por ejemplo, anillos dorados o plateados y distinguir una pieza agotada. | Separar subcategoría, acabado y disponibilidad; reutilizar señal Agotado existente y comprobar su origen. Puede dividirse en entregas menores. |
| FER-12 | P3 | Mostrar variantes de un diseño en dorado y plateado. | La clienta cambia de opción, reconoce su foto y disponibilidad y solicita la variante correcta. | Definir diseño vs producto, existencia y precio por variante; evitar fusionar inventario sin reglas. |
| FER-13 | P2 | Unificar la experiencia visual del catálogo. | Portada, categorías, búsqueda, bolsa y navegación se sienten coherentes en móvil y escritorio. | Diseñar junto a FER-10/11; tokens y componentes propios, presupuesto de imágenes y rendimiento. No requiere un editor visual in-place. |
| FER-14 | P2 | Recibir la selección pública como solicitud interna revisable. | Fer recibe el detalle sin recaptura, confirma precio/disponibilidad y lo convierte en pedido una sola vez. | El carrito de WhatsApp ya existe; revisar si hay antecedente específico en backlog. Definir identidad, duplicados, permisos, abuso y cuándo se afecta stock. Sin checkout ni cobro en línea. |
| FER-15 | P1 | Calcular el reparto de ganancia entre Fer, Olivia e inversionista. | Los importes coinciden con un ejemplo validado del Excel y suman exactamente la ganancia distribuible. | FER-03 y Excel; conocer porcentajes, vigencia, préstamo, pérdidas y redondeo. Es registro/cálculo, no transferencia de dinero. |
| FER-16 | P1 | Consultar y hacer el corte de cada mes por separado. | Agosto, septiembre y octubre se consultan sin mezclar ventas; detalle, totales y reparto son trazables y cuadran. | FER-03/15; definir fecha de atribución, zona horaria del negocio, pagos parciales, correcciones y cierre/reapertura. Una pestaña es una sugerencia de interfaz, no un requisito técnico. |

## Propuesta de entregas pequeñas

1. **Reducir errores y captura repetida:** FER-06 y FER-04 en cambios separados;
   después FER-08 y FER-07, definiendo cómo conviven agrupación y orden de captura.
   Un ticket en texto es una alternativa inicial para discutir, no una decisión
   tomada. No bloquear precios por clienta con todo el motor de renovación Iconic.
2. **Reemplazar los cálculos manuales:** recibir y estudiar el Excel; avanzar
   FER-01 → FER-02 → FER-03 → FER-15 → FER-16. Entregas independientes y números
   de ejemplo acordados antes de sustituir el control actual.
3. **Seguimiento de emprendedoras y reposición:** definir FER-05 y FER-09.
   Separar reglas/estado de los avisos externos. Investigar canal y costos en
   paralelo al primer grupo, sin prometer WhatsApp automático.
4. **Mejorar el catálogo:** diseñar FER-10/11/13 como experiencia conjunta y
   dividir la implementación; después solicitud interna FER-14 y variantes
   FER-12 según prioridades de Fer y Álvaro.

Las mejoras internas atienden a la mayoría de los pedidos que hoy llega por
fuera del catálogo. El rediseño público ayuda al crecimiento, pero por sí solo
no elimina la carga de captura actual. No se asignan tiempos sin revisar el
alcance y las dependencias de cada entrega.

## Preguntas que debemos cerrar primero

1. **Excel:** compartir el archivo y explicar un mes representativo, con una
   compra, una venta, todos sus gastos y el reparto. Revisar fórmulas, valores
   manuales, excepciones y redondeos. No asumir que importarlo o migrar todo su
   histórico ya está solicitado.
2. **Costos:** ¿se reparte por piezas o valor? ¿Cómo se asignan gastos de una
   compra a ventas de distintas clientas y meses? ¿Qué pasa con viajes que
   combinan entregas y pendientes personales? ¿Cuándo se registra el empaque?
3. **Iconic:** ¿más de $1,000 o desde $1,000? La entrevista dijo “superar”.
   ¿Con precio Regular o Iconic, antes o después de descuentos y gastos?
   ¿Cuenta capturar, pagar o entregar? ¿Qué mínimo renueva? ¿Cómo tratar días
   29–31, cancelaciones, gracia y asignación manual? ¿Qué regla aplica a Gibly?
4. **Cortes:** ¿venta del mes por qué fecha? ¿Cuándo hay ganancia repartible?
   ¿Cómo se registran abonos, devoluciones, pérdidas y gastos posteriores?
   ¿Se congela un corte o se recalcula? ¿Cómo se registra el pago al inversionista?
5. **Avisos:** confirmar canal de Iconic, frecuencia y anticipación; WhatsApp
   es preferido para stock. Si ese canal no cabe en cero costos, acordar una
   alternativa que conserve el objetivo, sin sustituirlo silenciosamente.
6. **Catálogo:** confirmar subcategorías reales, relación entre acabados y
   variantes, fotos disponibles y comportamiento esperado de piezas agotadas.

## Cruce con lo existente

Revisión estática en `main`, commit `a0c7360`, el 28 de octubre de 2026. No es
validación funcional ni revisión del despliegue o de datos de producción.

| Evidencia en el repositorio | Implicación para este ciclo |
| --- | --- |
| `src/types/index.ts`: `Order.items`, `OrderItem.priceTier` y `cost`. | Pedidos de varias líneas ya existen. La spec antigua de recibos que plantea crearlos no describe la base actual. No repetir esa migración por defecto. |
| `Store.priceTiers` y `defaultTierId`; `Customer` no tiene tipo de precio. | Hay base configurable para FER-04. No asumir que requiere rehacer todo `scalable-pricing`. |
| `Purchase.lines`, `shipping`, `discount`, `tax` y `purchaseTotals`. | FER-01 amplía Compras; registrar envío no demuestra que ya se distribuya en costo por pieza. |
| `Product.lowStockAt`, selector de bajo stock y campo en ProductForm. | FER-09 amplía una base de inventario existente; falta evaluar avisos externos. |
| `OliviaStorefront`: banner, rutas por categoría, carrito y etiqueta Agotado; `StorefrontEditor` permite imágenes del banner. | FER-10/11/13 requieren validar y ampliar la experiencia. La ausencia relatada de banner puede ser contenido, configuración o versión, no necesariamente falta de soporte. |
| `OrderForm` agrega líneas al final. | FER-06 corresponde a una fricción que coincide con el código. |
| `docs/backlog.json` conserva estados anteriores y `docs/BACKLOG.md` menciona un harness retirado en `LOOPS.md`. | Los estados antiguos no prueban pendientes actuales. Este ciclo enlaza los antecedentes; no los declara resueltos ni los vuelve a implementar sin auditoría. |

Antecedentes relacionados: `receipts`, `purchase-ux2-fast-receive`,
`scalable-pricing`, `unified-products`, `carrito-publico` y `wysiwyg-catalog`.
La edición in-place no fue solicitada en esta entrevista. Refresh y errores
al guardar siguen como riesgos históricos por verificar antes de trabajar en
los flujos afectados; no se afirmó que continúen fallando hoy.

## Límites y forma de trabajo

- Álvaro y Codex definen alcance, reglas y diseño; Claude Code implementa;
  Codex supervisa y revisa. Cada entrega lleva criterios, casos de ejemplo,
  pruebas proporcionales y revisión del diseño/aislamiento multitienda.
- Un cambio, una rama desde main, un draft PR. La spec de implementación viaja
  con el código. Esta minuta es descubrimiento, no una spec de feature aprobada.
- Typecheck, tests y build en verde antes del PR; e2e y Preview local de
  producción cuando corresponda. El humano revisa y hace merge; el agente no
  despliega producción ni opera datos productivos.
- Cero costos, español de México, mobile-first y sistema de diseño propio.
  Antes de cada implementación, estimar lecturas/escrituras, almacenamiento,
  descargas y cualquier servicio externo; confirmar que cabe en los límites.
  Este backlog no provisiona servicios ni genera consumo nuevo.
- Mejor vendidos queda como idea posterior. Shop the Look no se contempla
  por ahora. Instagram, newsletter, mapa, métodos de pago y otros elementos
  descritos en la referencia no se convierten en requisitos automáticamente.
- La referencia visual mencionada es ginebrajoyería.mx. No se inspeccionó el
  sitio para esta minuta; los comentarios proceden del dictado. Su estudio
  corresponde a la fase de diseño.
- No se amplía aquí a contabilidad general, facturación, pagos o transferencias,
  checkout, marketing automático ni auditoría completa de inventario. Los
  cálculos y cortes solicitados se definirán en su alcance operativo concreto.

## Siguiente sesión de definición

Propuesta: acordar el primer grupo de entregas, resolver las decisiones de
FER-04/06/08 y recibir el Excel para trabajar en paralelo las reglas de costos
y corte mensual. Medir con Fer tiempo de captura de un pedido representativo,
correcciones de precio y diferencias del corte para comparar el antes/después.
