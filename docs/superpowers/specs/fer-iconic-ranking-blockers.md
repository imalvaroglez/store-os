# FER-05/17 · Bloqueos de Iconic y evaluación de emprendedoras

## FER-05: vigencia Iconic

### Hechos confirmados

- El primer pedido que supere $1,000 da acceso a Iconic en ese mismo pedido.
- Se mantiene con otro pedido dentro de los siguientes 30 días; cada renovación dura otros 30 días.
- Fer quiere un aviso una semana antes del vencimiento, sin abrir la aplicación.
- La renovación es por periodo móvil de 30 días, no por mes calendario.

### Decisiones que bloquean automatizar la vigencia

1. ¿El umbral se calcula con precio Regular, Iconic u otra base? ¿Antes o después de descuentos? “Superar $1,000” excluye exactamente $1,000, pero falta acordar qué importe se compara.
2. ¿Cuenta capturar, pagar o entregar el pedido? ¿Qué pasa con cancelaciones y devoluciones?
3. Cuando un pedido renueva la vigencia, ¿los nuevos 30 días empiezan en la fecha del pedido o al vencer el periodo actual? ¿Cuál es la hora límite y zona horaria?
4. ¿Cómo se asigna Iconic manualmente, se recupera tras perderlo y cómo se relaciona Girly?
5. ¿Por qué canal se manda el aviso de siete días? El canal aún no está confirmado. Debe caber en cero costos; no prometer notificaciones externas hasta comprobarlo.

FER-04 puede aplicar precios asignados manualmente sin esperar esta automatización; no inferir aquí la elegibilidad.

## FER-17: top 3 de emprendedoras

### Hechos confirmados

- La evaluación es por mes calendario.
- Fer decide y entrega los premios; el sistema solo debe mostrar posiciones, importes y operaciones de respaldo.
- Un ranking antes de terminar el mes sería provisional. Fer busca premiar durante la primera semana del mes siguiente.

### Decisiones que bloquean el cálculo y el aviso

1. Medir pedidos que las emprendedoras compran a Olivia o ventas que hacen a sus propias clientas. Store OS no registra actualmente esas reventas externas.
2. Definir si cuenta pedido capturado, pagado o entregado; cómo afectan pagos parciales, cancelaciones, cambios y devoluciones; y la fecha/zona horaria del periodo.
3. Definir desempates, meses con menos de tres participantes y qué datos ve cada persona.
4. Elegir si el aviso se envía antes del cierre, al cierre o ambos, y por qué canal. Alinear la fecha final con FER-16 y demostrar costo cero.

## Secuencia

Mantener manuales las vigencias Iconic y los premios hasta acordar reglas y canal. Después separar cálculo de elegibilidad/ranking de cualquier aviso externo. No añadir Cloud Functions, Auth por SMS ni servicios de pago en esta fase.
