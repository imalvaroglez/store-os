# FER-14 · Bloqueo para recibir selecciones del catálogo

## Base actual

- El catálogo arma una selección en el navegador y la clienta la puede enviar manualmente por WhatsApp.
- Enviar la selección no reserva piezas. La existencia y el precio se confirman con Fer.
- El carrito del navegador es temporal; no existe una solicitud persistida que Fer pueda abrir en la app.

## Bloqueo

No habilitar escrituras anónimas a Firestore ni llamar “pedido” a una selección sin confirmar cómo se protege y atiende. Una colección pública de solicitudes añade una superficie de abuso, datos personales, costo de escrituras y riesgo de duplicar pedidos o afectar inventario.

## Decisiones necesarias antes de diseñar la entrega

1. **Identidad y contacto:** ¿qué dato mínimo identifica a la persona y permite a Fer responder? El flujo debe funcionar para quien no tiene cuenta Store OS. Auth por teléfono/SMS no se contempla por costo.
2. **Permiso y abuso:** ¿quién puede crear, consultar y cerrar una solicitud? ¿Qué límite de frecuencia y mecanismo antispam caben sin Cloud Functions ni un servicio pagado?
3. **Duplicados e idempotencia:** ¿cómo distingue Fer un reenvío de una nueva solicitud? Definir cuánto tiempo se conserva el identificador y qué pasa al reintentar sin conexión.
4. **Confirmación:** ¿cuándo la solicitud se convierte en pedido? Fer confirma producto, variante, precio, existencias y cantidades antes de tocar inventario.
5. **Datos y retención:** acordar campos personales estrictamente necesarios, quién los ve, cuándo se eliminan y cómo se atiende una solicitud de borrado.
6. **Presupuesto:** estimar lecturas, escrituras, reglas y retención para el volumen previsto; validar límites de costo cero antes de activar persistencia.

## Alternativas a comparar

- **Seguir con WhatsApp manual:** sin nueva escritura cloud ni bandeja interna, pero Fer puede tener que recapturar el detalle.
- **Solicitud persistida:** evita recaptura, pero necesita resolver permisos, antispam, identidad mínima, idempotencia, retención y presupuesto. No reserva ni descuenta existencias hasta que Fer confirme y la convierta una sola vez.

No se selecciona una alternativa en este documento. El carrito y los mensajes actuales continúan operando como antes.

## Restricciones

- Sin checkout, cobro, reserva automática ni pedidos sin confirmación de Fer.
- Sin Cloud Functions, auth telefónica ni servicios externos con cobro.
- No permitir lecturas públicas de las solicitudes.
- No escribir datos en `store-os-dev` o producción durante la exploración.
