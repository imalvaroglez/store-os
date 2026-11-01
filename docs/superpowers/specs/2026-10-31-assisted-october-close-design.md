# Captura asistida y corte de octubre

Fecha: 31 de octubre de 2026. Prioridad táctica acordada con Álvaro.

## Objetivo

Reconstruir las ventas de octubre que siguen en conversaciones de WhatsApp,
compararlas con el Excel existente y completar una copia para preparar un
corte verificable. La captura y la comprobación las hace el asistente; la
operadora confirma únicamente hechos o reglas que la evidencia no resuelve.
No se le pide actualizar primero el Excel: esa es parte de esta ayuda.

## Fuentes y estado

- El Excel compartido el 28 de octubre sigue siendo el único archivo existente.
  Se verificó el mismo SHA-256 del ensayo E0. No incluye necesariamente las
  ventas y los cobros recientes.
- Álvaro identifica WhatsApp como fuente probable de las ventas pendientes.
  El 1 de noviembre aportó un primer mensaje de detalle de pedido copiado para
  probar la captura. La prueba conserva ese contenido fuera de Git; no es
  necesario obtener antes una exportación completa ni actualizar el Excel.
- No hay un conector WhatsApp disponible en esta sesión. Se puede usar la
  exportación de texto del chat desde el teléfono; los adjuntos necesarios se
  revisan aparte. No se envían mensajes ni se instalan servicios.

## Entrega por etapas

### 1. Preparación independiente de los chats reales

`scripts/whatsapp-close-intake.cjs` lee exportaciones de texto UTF-8 comunes de
Android o iOS y genera JSON de evidencia, CSV para revisar y una guía de
captura. Conserva líneas, mensajes completos, remitente del texto, fecha local
del mensaje y SHA-256 de la fuente. La fecha no se convierte a UTC ni se usa
como fecha de venta, entrega o cobro.

El orden día/mes se indica expresamente. No se descartan los mensajes de otros
meses: pueden explicar un pedido o un cobro de octubre. Fechas imposibles,
posibles encabezados con formato no admitido y líneas sin encabezado reconocible
quedan como incidencias; mensajes idénticos
se conservan y se señalan para revisión. El texto no se clasifica como una
transacción por palabras o importes. Los adjuntos omitidos quedan identificados
cuando el export los señala; no se interpreta su contenido ausente.

Una ejecución parcial por errores de lectura devuelve código 2 y mantiene su
reporte. El asistente revisa esas incidencias antes de preparar operaciones.
La herramienta no modifica el Excel, el chat ni un paquete generado antes.

También admite `--format pasted-note` para un mensaje copiado sin los
encabezados de una exportación. Se guarda como una sola evidencia completa,
sin inventar remitente, hora o fecha del mensaje. El nombre y fecha escritos
en el contenido se revisan por separado. Este modo no clasifica la nota como
venta entregada o cobrada, ni calcula importes por sí mismo.

### 2. Piloto con una conversación real

El asistente reconstruye un pedido con producto/clave, cantidad, precio y
subtotal, fecha de venta, entrega, cobros y cambios. Cada afirmación conserva
referencias al chat y líneas. Un ofrecimiento de pago no es un cobro confirmado;
una cotización no es una venta. Se conserva el conflicto entre versiones hasta
resolverlo con evidencia o con la operadora.

Se compara contra el Excel por operación y contenido. Nombre, fecha o importe
similares solo proponen una coincidencia; no eliminan ni agregan pedidos
automáticamente. Las fotos, audios o comprobantes necesarios se revisan antes
de dar por completa la operación. No se inventan cantidades, precios, costos
ni fechas faltantes. Se entrega una lista corta de preguntas y se comprueba
que este proceso realmente reduce su captura.

### 3. Completar octubre y preparar el corte

Con el piloto revisado se procesan las demás conversaciones. La salida será un
archivo auxiliar con Corte de octubre, Detalle y Pendientes. El original queda
intacto. Las ventas, los cobros y los saldos se presentan por separado; una
ganancia con costo incompleto permanece sin determinar.

Se conservan los costos históricos identificables. Se aclara qué incluye
Packing antes de sumar empaque/envío otra vez. Las compras recientes y las
piezas para puntos de venta se relacionan aparte; no se descuentan del corte
por inferencia ni bloquean las operaciones cuyos costos sí están respaldados.

El reparto 20% inversión, 50% operadora y 30% fondo Olivia está confirmado,
pero la propuesta solo se calcula al acordar su base elegible. Antes de
presentar el cierre como definitivo se confirma qué fecha determina el mes,
tratamiento de abonos, devoluciones y operaciones pendientes. No se exige
resolver por adelantado todo el motor financiero estratégico de Store OS.

## Revisión humana y aceptación

- El asistente hace la captura, contrasta fórmulas y conserva trazabilidad de
  cada total hasta el detalle y la evidencia original.
- La operadora confirma cobros efectivos y responde las excepciones. Álvaro
  y la operadora consideran y aprueban el corte propuesto.
- Las ventas que ya estaban en el Excel no se vuelven a sumar. Los importes de
  renglón que incluyen cantidad no se multiplican una segunda vez.
- Las participaciones propuestas suman exactamente la base acordada en
  centavos; los importes sin respaldo permanecen identificados.
- La revisión de datos reales no puede completarse solo con chats sintéticos.
  El objetivo sigue activo hasta recibir fuentes y resolver lo indispensable.

## Ejecución y privacidad

```bash
node scripts/whatsapp-close-intake.cjs \
  --input /ruta/al/chat.txt \
  --month 2026-10 \
  --date-order dmy \
  --out .local/monthly-close/chat-01
```

Para un mensaje copiado se omite `--date-order` y se usa `--format pasted-note`.
El detalle estructurado y el archivo de prueba se generan durante la captura
asistida y conservan referencias a las líneas de esa nota. La prueba real y sus
importes no se usan como fixtures públicos del repositorio.

Los chats y reportes reales se guardan fuera de Git; el directorio sugerido
está ignorado. El PR contiene solamente herramienta, pruebas y documentación,
nunca clientas, mensajes, comprobantes ni el Excel real. El CSV neutraliza texto
que un programa de hojas de cálculo podría interpretar como fórmulas; el JSON
conserva el texto sin ese cambio.

Consumo cloud adicional: cero lecturas, cero escrituras, cero almacenamiento y
cero servicios nuevos. No se accede a Firebase productivo ni se cambia la
persistencia administrativa de Store OS. Este trabajo es asistencia sobre
archivos aportados para el corte y no introduce otro modo administrativo.

## Validación de esta primera etapa

Pruebas sintéticas de Android/iOS, mensajes de varias líneas, formatos de fecha
ambiguos, fechas inválidas, contexto entre meses, duplicados, adjuntos omitidos,
texto interpretable como fórmula, conservación de fuentes y rechazo de
sobrescritura. Typecheck, pruebas y build del repositorio antes del draft PR.
No cambia interfaz, rutas, reglas ni runtime; no requiere una nueva Preview de
interfaz ni E2E adicionales para esta herramienta.

El parser permite comenzar la revisión. No entrega todavía el Excel actualizado
ni un corte real: esas etapas requieren las conversaciones originales.
