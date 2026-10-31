# Showcase: hallazgos y revisión del backlog

Fecha: 30 de octubre de 2026. Fuente: observaciones de Álvaro durante el
showcase con Fer y aclaración posterior sobre la configuración de una clienta.

**Estado: registro de feedback, sin implementación.** Este chat se usa para
reunir errores, fricciones y necesidades, relacionarlos con el backlog y
reevaluar prioridades. Las propuestas no autorizan cambios de producto ni
sustituyen el diseño pendiente de cada entrega.

**Actualización posterior:** Álvaro definió una meta de entrega para revisión
en dev el 31 de octubre a las 08:00, incluyendo las correcciones y el flujo
de inventario por viaje. La [entrega en curso](superpowers/specs/2026-10-30-showcase-purchase-fixes-design.md)
documenta la primera etapa y las decisiones confirmadas: varios proveedores
por viaje, costo completo de la última compra y nivel elegido una vez por
clienta. Este cambio
de etapa no convierte las propuestas anteriores en reglas aprobadas.

## Clientes: Emprendedora no aplicó Iconic al crear un pedido

Relacionado con `fer-customer-price-tier` (FER-04) y `fer-iconic-renewal`
(FER-05). Prioridad propuesta para la claridad y aplicación del precio: P1,
por el riesgo de capturar un cobro distinto del esperado.

- **Configuración confirmada:** Álvaro había seleccionado únicamente
  “Emprendedora” en “Tipo de cliente”; no había asignado Iconic en “Nivel
  de precio”.
- **Observado:** al crear un pedido para esa clienta apareció Regular y fue
  necesario seleccionar Iconic manualmente.
- **Esperado:** el precio que corresponde a la clienta se aplica de forma
  automática al capturar el pedido, con una configuración comprensible.
- **Código actual:** clasificación y nivel de precio son campos separados.
  El pedido usa el nivel asignado y, si no existe, el predeterminado de la
  tienda. El caso confirmado es una diferencia de expectativas/configuración;
  no demuestra que falle la aplicación de un Iconic expresamente asignado.

FER-04 necesita revisar la relación y presentación de ambos campos para que
la operadora entienda qué precio se aplicará. La expectativa expresada se
conserva sin convertir “toda emprendedora siempre recibe Iconic” en una nueva
regla aprobada ni cambiar retroactivamente la spec anterior.

## Seguimiento por clienta y vigencia Iconic

Álvaro quiere consultar los pedidos de cada clienta y reconocer si realizó una
compra en los últimos 30 días para mantener el beneficio que le corresponde.
Se relaciona con FER-05; no se crea otra entrada para la misma necesidad.

El código revisado ya asocia pedidos con clientas y muestra cantidad de
pedidos, vendido y saldo. Eso no equivale a un historial detallado ni a un
seguimiento automático de la vigencia. La automatización de los 30 días sigue
pendiente; no se verificó el comportamiento de un despliegue específico.

Resultado deseado para el diseño: consultar pedidos y sus estados, identificar
la última compra que cuenta para Iconic y mostrar si el beneficio está vigente
y hasta cuándo. Mantener abiertas las reglas ya documentadas en
[FER-05](superpowers/specs/fer-iconic-ranking-blockers.md): qué evento cuenta
como compra, desde cuándo se renueva, cancelaciones/devoluciones y relación
entre tipo de clienta y beneficio. No se asume que perder Iconic cambia
automáticamente la clasificación de emprendedora.

## Compras: reiteración y explicación del desglose

Las [notas de Compras](purchase-feedback-2026-10-30.md) conservan el detalle.
Álvaro reiteró que vincular el producto del ticket reemplaza el costo escrito;
hay que conservar ese importe. También pidió coherencia visual entre Compras
y Pedidos, y entender los campos actuales antes de decidir su rediseño.

La explicación del cálculo actual queda en esa nota. Documentar su función no
aprueba conservar todos los campos ni resuelve el prorrateo futuro. El
problema de comprensión forma parte de `purchase-entry-polish`.

## Cómo incorporar los siguientes reportes

Cada hallazgo registra contexto, pasos o configuración conocidos, resultado
observado, resultado esperado, evidencia disponible y entrada relacionada.
Separar lo confirmado de la causa por comprobar y de las propuestas de diseño;
ampliar una entrada existente cuando corresponda en lugar de duplicarla.

Revisar la prioridad con cada reporte según impacto en importes y datos,
bloqueo de tareas, frecuencia y alcance. Para estos hallazgos, se propone
atender primero la captura de decimales y la conservación del costo, y la
claridad del precio por clienta. El acabado visual y la explicación de totales
también requieren atención; la compra por viaje y el reparto necesitan su
diseño antes de implementar.

Esta revisión no reordena automáticamente la cola global, no modifica los
bloqueos P0 existentes y no inicia trabajo de aplicación. La prioridad de
FER-05 permanece como propuesta P2 hasta acordar sus reglas.
