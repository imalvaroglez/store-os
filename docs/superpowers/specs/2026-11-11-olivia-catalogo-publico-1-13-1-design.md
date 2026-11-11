# Olivia · Correcciones del catálogo público 1.13.1

11 de noviembre de 2026 · Base revisada: Store OS 1.13.0, `45a1259`

La clienta debe poder explorar las categorías con fluidez, comparar precios por pieza sin abrir ayudas, preparar su selección y pasar a WhatsApp sabiendo qué va a confirmar Olivia. Fer debe poder editar la información de entregas y horarios y comprobar qué se publicó. El objetivo es liberar el parche en la primera ventana apta.

## Alcance y orden de trabajo

| Frente | Entrega | Referencia |
| --- | --- | --- |
| Ficha de producto | Precio y condición de cada nivel alineados y visibles | Capturas 1–2 |
| Mi pedido | Miniaturas, cantidades, importes, nombre, aviso y acción de WhatsApp | Captura 3 |
| Marca y pie | Logo transparente en encabezado y pie blanco | Captura 4 |
| Categorías y fluidez | Dos filas de cinco en escritorio, estados interactivos y scroll medido | Capturas 5–6 |
| Editar sitio | Edición y publicación comprobable de entregas y horarios | Recorrido descrito por el PO |
| Confirmación comercial | Una casilla junto a WhatsApp, condicionada a las Condiciones de compra publicadas y validadas | [#312](https://github.com/imalvaroglez/store-os/issues/312) y [#311](https://github.com/imalvaroglez/store-os/issues/311) |

El trabajo visual y de edición puede avanzar mientras se resuelven las condiciones. Coordinar un solo responsable para los cambios concurrentes a `OliviaStorefront`, `CartDrawer` y sus estilos. Registrar el contrato y la evidencia en las issues y llevar esta spec al PR de implementación. Reutilizar #312 para la casilla y #311 para la revisión del aviso de privacidad. Las modificaciones compartidas con otros catálogos requieren una prueba de regresión en otra tienda.

## 1. Precios en la ficha de producto

En las capturas 1–2, Regular tiene el importe en un eje distinto al de Girly e Iconic. El signo «?» ocupa espacio junto al importe y puede mostrar a la vez una ayuda negra y la nativa del navegador. En 1.13.0, `PublicTierPrices` en `CartDrawer.tsx` renderiza ambos mecanismos para esas filas.

- Usar una sola composición de tres columnas. Nivel a la izquierda, importe alineado a la derecha en una columna intermedia de ancho compartido y condición a la derecha, alineada a la izquierda. Conservar una sola cabecera «Precio por pieza».
- Dar a la condición una jerarquía secundaria y legible. Mantener orden, importes y énfasis de los niveles según la configuración. Regular deja la tercera celda vacía si carece de requisito. Quitar de la ficha el «?», la ayuda flotante y el `title` duplicado. Las condiciones forman parte de la información que la clienta necesita para comparar.
- Girly muestra la cantidad real de la tienda, por ejemplo «Desde 5 piezas». Para Iconic usar «Con beneficio Iconic vigente» como explicación principal. Si se explica cómo obtenerlo, distinguirlo del precio de esta solicitud. Según #130, un pedido liquidado desde $1,000 MXN puede activar el beneficio para compras posteriores. Olivia verifica la vigencia. Evitar «desbloquear Iconic» si hace pensar que agregar piezas aplica el precio a la solicitud actual.
- Los niveles y precios salen de la configuración pública. Una condición por importe de otro nivel respeta la base de cálculo configurada. Si hay dos mínimos, mostrar ambos según la regla vigente. Los ejemplos de las capturas sirven para probar el acomodo.
- En móvil, cuando la condición no quepa, puede bajar a una segunda línea de su propia fila. Los importes comparten eje, sin recorte, desbordamiento ni letra diminuta. Conservar las salidas vigentes para precio único, niveles sin precio y «Consultar precio». Las tarjetas de la cuadrícula conservan su presentación compacta «Desde».

Ejemplo de composición para la ficha de las capturas, con importes ilustrativos:

| Nivel | Importe | Condición visible |
| --- | ---: | --- |
| Regular | $140 | |
| Girly | $105 | Desde 5 piezas |
| Iconic | $55 | Con beneficio Iconic vigente |

**Aceptar cuando** Regular, Girly e Iconic comparten eje de importes con valores de distinta longitud, las condiciones se entienden por toque y teclado, y la ficha conserva sus recorridos de galería, cantidad y agregado al carrito.

## 2. Mi pedido

### Líneas de producto

- Mantener foto, nombre, variante cuando aplique y avisos de pocas piezas o encargo. Usar `ProductImage` con un tratamiento de miniatura neutro en el carrito de Olivia. Reproducir el contorno azul para distinguir un borde aplicado a la imagen, un borde dentro del archivo y un indicador real de foco. Retirar el borde decorativo visible en reposo y conservar foco visible en controles interactivos.
- Bajo el nombre y aviso, usar una cuadrícula con dos zonas. A la izquierda, `−  cantidad  +`. A la derecha, «Precio por pieza» y «Subtotal» con sus importes alineados a la derecha. Las zonas comparten altura visual y el selector se centra respecto a las dos líneas de importes. Dar a `−` y `+` la misma variante, alto y ancho, con área táctil de al menos 40 px y nombre accesible que identifique la pieza cuando hay varias líneas. En móvil, recomponer en filas contiguas cuando falte ancho.
- Las cantidades actualizan el precio y subtotal visibles en el mismo cambio. Si existe subtotal habitual, usar ese mismo nivel para los importes de línea. Hoy las líneas y el resumen se derivan de funciones distintas. Añadir una prueba donde el cálculo general alcance el umbral de Iconic, para comprobar que las líneas del carrito anónimo no muestren un precio Iconic mientras el total usa Regular o Girly. Corregir esa discrepancia de presentación si se reproduce. Mantener el cálculo contable y las tarifas de negocio.

### Nombre, resumen y WhatsApp

- Quitar la etiqueta visual «Tu nombre» y usar «Escribe tu nombre para identificarte» como placeholder. Conservar «Tu nombre» como nombre accesible. Mantener el comportamiento actual del campo, sin agregar requisito de teléfono, cuenta o identificación.
- Mostrar un solo aviso común junto a los estimados. Texto propuesto para Olivia: «Los precios son estimados. Por WhatsApp confirmamos tu beneficio, disponibilidad, total y entrega. Envío no incluido. Tu selección no reserva las piezas». Usar el mismo aviso cuando el precio quede por confirmar. Quitar el párrafo repetido debajo de la acción. La captura 3 y la versión base indican **envío no incluido**. Cambiar la política de envío requiere confirmación explícita de Fer o del PO.
- Usar una sola acción «Enviar solicitud por WhatsApp». Conservar el texto agrupado por categoría, las piezas y cantidades, y el carácter estimado de los importes. Usar un solo control semántico accionable con teclado y toque. Abrir WhatsApp conserva la selección y por sí solo no crea pedido, cobro, reserva ni escritura pública.
- Conservar el contrato de [#305](https://github.com/imalvaroglez/store-os/issues/305). Estimación habitual siempre que se pueda calcular. Comparación Iconic pasiva solo cuando el subtotal habitual es menor a $1,000 MXN, alineada dentro del mismo resumen. Desde $1,000 inclusive, desaparece también del mensaje. Si falta un precio Iconic, la fila muestra «Por confirmar» y el mensaje omite esa cifra.

### Casilla comercial

**Decisión vigente.** #312 autoriza activar la casilla obligatoria únicamente cuando existan las Condiciones de compra de Olivia, estén publicadas en una URL estable y hayan pasado la revisión jurídica humana acordada. #311 lleva el aviso de privacidad por separado. La casilla no aparece en 1.13.0 porque su activación quedó fuera de #305 y condicionada a esa publicación.

- Una vez satisfecha la condición, colocar una sola casilla sin marcar **inmediatamente antes** de «Enviar solicitud por WhatsApp». Texto propuesto: «Leí las Condiciones de compra». Enlazar «Condiciones de compra» al documento real, accesible sin sesión. El enlace se puede abrir independientemente de la casilla.
- Mantener la frase en una línea donde quepa. En móvil, permitir que el texto envuelva con legibilidad. Hacer que tocar el texto de la casilla cambie su estado, excepto al activar el enlace. Mantener foco visible y nombre accesible. Evitar etiquetas HTML anidadas.
- Sin marca, la acción queda inactiva y su activación no abre WhatsApp. Al marcar se habilita y al desmarcar se vuelve a bloquear. Mantener el estado solo para la solicitud abierta y reiniciarlo al volver a abrir el carrito o modificar su selección. Abrir las condiciones o volver de WhatsApp conserva las piezas. Validar que ninguna ruta equivalente de envío de carrito se salte la confirmación. Las consultas de una sola pieza fuera del carrito conservan su alcance.
- Si la condición de #312 sigue pendiente al liberar 1.13.1, publicar el resto con aviso informativo y envío disponible. La casilla permanece pendiente en #312. Evitar links vacíos, términos ficticios, registro de aceptación y consentimiento de marketing.

**Aceptar cuando** los controles y las cifras se leen alineados en escritorio y funcionan por toque a 390 px. Probar pedido de una pieza y de varias categorías, nombre vacío y capturado, foto con/sin borde, aviso de stock, cruce de $999.99 a $1,000.00 y $1,000.01 en ambos sentidos, condición Iconic incompleta y WhatsApp con y sin documento comercial habilitado.

## 3. Logo y pie de página

- Conservar el logo rosa original de Olivia, con proporciones y color existentes, en un recurso con transparencia real. Revisar si se está mostrando `storefront.logoUrl` o el archivo de respaldo `public/images/olivia-logo.png`. Corregir la fuente efectiva. Preferir el original transparente y verificar alfa en los bordes y huecos de las letras. No usar un fondo blanco pintado, un filtro CSS ni la captura como imagen de producción.
- Usar la misma resolución de logo en encabezado y pie, con tamaño reservado y alternativa accesible. Si la fuente activa es un logo configurado con fondo, el PR debe identificar el paso autorizado para sustituirlo desde el editor y verificar primero el resultado en dev. Respetar los logos de otras tiendas.
- Interpretar el cambio de color pedido como retirar la franja de color del pie y seguir con fondo blanco. Sustituir el nombre grande en texto por el logo transparente. Conservar la navegación útil, WhatsApp, «Entregas y atención» y los enlaces de privacidad y condiciones cuando existan. Los elementos informativos permanecen legibles con tokens de Olivia. Verificar contraste sobre blanco.

**Aceptar cuando** el logo se ve integrado sobre blanco en inicio, categoría y ficha, sin rectángulo crema ni distorsión. El pie conserva sus enlaces, se adapta a móvil y coincide con la vista previa del editor.

## 4. Categorías y movimiento

- La portada con diez categorías muestra **5 + 5** al ancho de escritorio de referencia. Las celdas son de igual ancho y usan el espacio del contenedor. Alinear imágenes y nombres, mantener orden, evitar recortes de piezas y conservar la selección de categorías existente. Con otros conteos o anchos, recomponer con columnas que quepan y distribuir la última fila de forma equilibrada. Probar 0, 1, 7, 10 y 11 categorías, nombres largos y categoría sin imagen. En móvil evitar scroll horizontal de página y conservar blancos táctiles cómodos.
- Al pasar el cursor por una categoría, atenuar suavemente la foto con una transición breve de opacidad. Mantener la etiqueta y el foco legibles. Añadir respuesta al toque y al foco sin depender de hover para identificar ni abrir la categoría.
- Al entrar a «Cadenas» u otra categoría, conservar la navegación por nombres y su estado activo. Hacer una transición breve de entrada del contenido o del estado activo con tokens de movimiento. El enlace, el historial, el botón Atrás y el foco deben funcionar aun con movimiento reducido. Evitar animar toda la cuadrícula de productos o esperar a la animación para mostrar resultados.

**Aceptar cuando** la comparación antes/después a ~1280 px muestra 5 + 5 y alineación. En móvil, las categorías pueden recorrerse y seleccionarse por toque y por teclado. Verificar acceso directo a la ruta, selección, cambio de categoría, Atrás y preferencia de movimiento reducido.

## 5. Fluidez al recorrer la portada

La lentitud al hacer scroll es una observación del PO. La causa queda por medir. `OliviaStorefront` ya carga en paralelo datos de tienda y resumen, y `ProductImage` ya soporta carga diferida, decodificación asíncrona y dimensiones intrínsecas.

1. Grabar una traza en Preview local sobre `store-os-dev` o emuladores con catálogo sintético representativo. Repetir el mismo recorrido en la base y el candidato, en escritorio y móvil, con caché fría y caliente. Registrar navegador, tamaño de muestra, resolución y limitación de CPU/red si se usa.
2. Comparar al menos tres corridas por escenario afectado. Medir solicitudes y bytes de imagen, tareas largas, cuadros perdidos durante scroll y desplazamientos de layout. Identificar si el costo viene de descarga, decodificación, render, pintura o trabajo de React antes de elegir la corrección.
3. Si son imágenes, revisar tamaños servidos, carga diferida fuera de pantalla y reserva de espacio. Conservar la prioridad de la imagen principal. Si son repintados o render, corregir el costo identificado y mantener el hover con opacidad. Usar caché normal del navegador y recursos versionados donde aplique, con edición de fotos que se refleje correctamente.
4. Mantener el presupuesto de lecturas públicas actual en inicio, categoría y ficha. Medir que el cambio no introduce consultas por tarjeta, descargas duplicadas ni servicios nuevos. Los nuevos recursos estáticos del catálogo deben caber en el presupuesto gratuito con datos de peso medidos en el PR.

**Aceptar cuando** se adjuntan trazas comparables, se demuestra mejora en la métrica asociada al tirón reproducido y la visita caliente no vuelve a descargar imágenes sin motivo. Si no se reproduce, dejar evidencia de lo probado y qué dispositivo o grabación falta para diagnosticarlo. Las correcciones visuales pueden seguir su entrega.

## 6. «Entregas y atención» en Editar sitio

El código de 1.13.0 ya conecta los controles de envíos y horarios a `storefront.shipping` y `storefront.hours`, y guarda el borrador mediante el flujo de publicación existente. Reproducir con una cuenta autorizada si el problema está al descubrir el control, editarlo, guardar, actualizar la proyección o recargar. Verificar por separado texto configurado y valor de respaldo.

- En `Editar sitio`, el bloque tiene controles claramente identificables para «Entregas y envíos» y «Horarios». Abrirlos con toque o teclado. Mostrar el borrador dentro del bloque y conservar el guardado de todo el sitio. «Entregas y atención» puede permanecer como título de la sección. El alcance de esta corrección es que Fer pueda cambiar el contenido operativo que reportó fijo.
- Conservar el texto publicado hasta que el guardado termine correctamente. Salir sin guardar descarta el borrador. Si falla, mostrar error y conservar lo escrito. Verificar que al limpiar un campo no reaparece el valor antiguo después de recargar. Para envíos, si se usa el respaldo existente, que sea el mensaje neutro de consultar a Olivia. Sin horarios configurados, no publicar horarios. Mantener saltos de línea del contenido cuando sean útiles.
- Reutilizar el modelo y la proyección pública existentes. `saveStorefrontBatch` usa una escritura por lote en tres documentos por guardado. Verificar semántica de borrado de campos y preservación de otros datos del sitio antes de cambiar ese guardado. Evitar escrituras al teclear, proyecciones adicionales y una segunda copia de los textos. Probar la lectura anónima y el aislamiento por tienda.

**Aceptar cuando** Fer puede abrir el editor, cambiar ambos textos, guardar y comprobar en una sesión anónima que se leen los nuevos valores tras recargar. Probar también cancelar, vaciar, guardar con error y reintentar.

## Validación y liberación

- Tareas de la misión UX independiente: explorar portada → entrar a Cadenas → abrir ficha → comparar niveles → agregar piezas → ajustar cantidades → abrir WhatsApp. Segunda tarea: editar envíos y horarios → guardar → revisar como visitante. Usar datos sintéticos y evidencia a ~390 px, ~1280 px y en el ancho de las capturas de referencia.
- Verificar teclado, toque, foco, movimiento reducido, nombre largo, distinta longitud de importes, imágenes rotas y una tienda distinta de Olivia. Adjuntar antes/después y traza de scroll. No se necesitan capturas con datos reales de clientas.
- Pasar typecheck, tests, build, pruebas focalizadas de catálogo/carrito/editor y CI completo. Validar el build de producción en Preview local contra dev/emuladores, con revisión independiente de código y UX. Confirmar cualquier compuerta de aprobación de Fer registrada en las issues.
- Para 1.13.1, incrementar versión y notas de versión, comprobar guard y publicar el SHA revisado por la ventana autorizada. Verificar versión y SHA servidos y registrar las historias efectivamente liberadas. Preparar una nota breve para Fer con los cambios que entraron, incluyendo la casilla solo si quedó habilitada.
- Si hay un paso de actualización de logo configurado o de proyección en dev, dejarlo descrito en el PR con su procedimiento autorizado para producción. Las pruebas y correcciones de datos se hacen en dev/emuladores. Al entregar, registrar si el worktree quedó limpio y conservado, retirado o con trabajo pendiente documentado.

### Referencias internas

- [Spec vigente del resumen del carrito](https://github.com/imalvaroglez/store-os/blob/45a1259/docs/superpowers/specs/2026-11-10-olivia-cart-request-summary-ux-design.md)
- [#130 · Vigencia de Iconic](https://github.com/imalvaroglez/store-os/issues/130)
- [#305 · Estimados y solicitud por WhatsApp](https://github.com/imalvaroglez/store-os/issues/305)
- [#311 · Aviso de privacidad](https://github.com/imalvaroglez/store-os/issues/311) y [#312 · Condiciones y casilla](https://github.com/imalvaroglez/store-os/issues/312)
- [#315 · Densidad útil](https://github.com/imalvaroglez/store-os/issues/315) y [#331 · Acciones, ayuda, movimiento y cierre de worktrees](https://github.com/imalvaroglez/store-os/pull/331)
