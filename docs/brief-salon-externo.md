# Brief — ¿Prueba Olivia la venta en un salón externo?

> Para revisar con Fer (coordina Álvaro). **Decisiones no tomadas aquí**: este documento presenta hechos verificados, opciones y preguntas; nada cuenta con aprobación de Fer ni de Mari. No se contacta a nadie desde esta tarea.

## 1. Qué existe hoy (verificado en el producto)

- **Catálogo público** por tienda con solicitud manual por WhatsApp (#305, Hecho): la clienta arma su pedido y Fer confirma beneficio, disponibilidad, total y entrega. **Sin checkout, sin pagos en línea, sin reservas desde el acceso público.**
- **Inventario y precios por nivel** (Regular/Girly/Iconic) con membrecía por tienda; toda operación administrativa requiere sesión (`firestore.rules`). No hay cuentas para terceros fuera de la membresía de tienda.
- **Pedidos con entregas datadas** (#333, Hecho): qué pieza salió, cuándo y a qué precio. **Incidencias de posventa** (#203, Hecho): devolución, reemplazo y compensación auditadas. **Compras por ticket** con recepción (#206/#207, Hecho).
- **En curso (Testing, no en producción)**: subtotales por nivel en el carrito (#442), corrección del estimado Iconic (#437/#444), encargo y selector de color (#135/#137/#434), diagnóstico de precios (#335/#446).
- **Brechas**: sin multi-ubicación de inventario (una tienda = un estante); sin cuentas con permisos de solo lectura; sin desglose de consumo por tienda (#204 en preparación); sin facturación/CFDI; sin reporte por punto de venta.

## 2. Opciones (comparación, no selección)

| | **A. Fer registra y concilia manualmente** | **B. Acceso limitado de Mari** | **C. Catálogo/QR del salón** |
|---|---|---|---|
| Cómo funciona | Mari anota en papel/WhatsApp; Fer captura pedidos y salidas en Store OS como hoy | Mari recibe una cuenta de miembro con permisos acotados a capturar pedidos del salón | El salón muestra el catálogo público de Olivia por QR; los pedidos llegan por WhatsApp como hoy |
| Carga operativa | Alta para Fer (doble registro), mínima para Mari | Media: Mari captura, Fer revisa | Baja: sin registro nuevo; el pedido entra por el flujo existente |
| Exactitud | Depende del transcribido; discrepancias al conciliar | Buena: un solo registro | Buena para precios; la **pieza entregada** sigue confirmandose por WhatsApp |
| Permisos/privacidad | Sin cambios | Requiere historias de permisos nuevos (hoy miembro = acceso amplio a la tienda); datos de clientas visibles para Mari | Sin cambios: el catálogo público no expone datos privados |
| Riesgo de dinero/existencias | Conciliación manual; faltantes detectables tarde | Mari podría tocar pedidos ajenos si los permisos no se acotan | Mínimo: sin dinero ni inventario en línea |
| Consumo/costo | Cero (todo cabe en cuotas actuales) | Cero si se reusa Firestore; validar lecturas nuevas | Cero: el catálogo público ya existe |
| Esfuerzo técnico | Ninguno | Medio: permisos por rol, auditoría, UI | Ninguno (hoy); el QR es material impreso |

**Nota**: la recomendación de menor complejidad es **A para medir interés real** y **C para mostrar piezas** — pero la decisión es de Fer.

## 3. Preguntas para la conversación

**Exclusivas de Fer** — surtido y exhibidores del salón; precio a usar (¿Regular?); descuentos y margen mínimo; aceptación de riesgo de daño/robo. Efecto: definen qué se lleva y a qué precio; nada se construye hasta resolverlas.

**Acuerdos Fer+Mari** — comisión (la cifra tentativa del 20% es pregunta, no regla); quién cobra el dinero (¿Mari cobra y liquida, o cobra directo Fer por transferencia?); periodicidad de corte y liquidación; qué pasa con pérdidas/daños; terminación del piloto. Efecto: definen el flujo de dinero y liquidación; sin ellas no hay diseño de captura.

**Validación externa** — contrato/comisión por escrito; impuestos/CFDI de la comisión; comprobantes de liquidación. Efecto: ninguna opción habilita producción sin esta revisión.

## 4. Ejemplos sintéticos (separan conceptos; sin personas reales)

- **Movimiento de inventario**: 3 aretes salen al salón → salida registrada; siguen siendo de Olivia. No son venta.
- **Venta entregada**: clienta compra 1 arete en el salón → pedido con entrega datada; ese día se reconoce la venta.
- **Cobro**: Mari recibe $200 en efectivo → el dinero está en manos de Mari hasta el corte; Store OS solo registra el pedido.
- **Comisión**: al corte, ventas $1,000 × comisión acordada = a liquidar a Mari; el resto a Olivia. Cifras acordadas por ambas.
- **Discrepancia física**: al corte faltan 2 piezas → se registra como faltante/daño según el acuerdo; **ningún faltante se convierte en venta por inferencia**.
- **Devolución**: clienta devuelve una pieza dentro del plazo → incidencia de posventa; la pieza vuelve al estante tras revisión.
- **Corte en cambio de mes**: ventas del corte cruzan el día 30/1º → cada venta queda en su fecha efectiva de entrega; el corte comercial es independiente del mes calendario.

## 5. Cómo medir un piloto (sin fijar números comerciales)

- **Línea base**: piezas mostradas, precio, visitas/consultas (contador manual o de la plataforma del salón si existe).
- **Rotación por pieza y punto**: piezas vendidas ÷ piezas mostradas, por semana; usa fechas efectivas de entrega (#333).
- **Exactitud de inventario**: piezas contadas en corte ÷ piezas que el sistema dice que están en el salón.
- **Margen con costos reales**: precio vendido − costo completo por pieza (ya calculado por Store OS); sin costo conocido, se reporta aparte.
- **Liquidación oportuna**: días entre corte y dinero en manos de Fer.
- **Tiempo de Fer**: horas por semana dedicadas al registro/conciliación.
- Los **objetivos numéricos los acuerda Fer**; esta lista solo define qué se puede medir sin construir nada.

## 6. Decisión a registrar

☐ **No avanzar** · ☐ **Seguir con registro manual (A)** · ☐ **Autorizar fase de diseño** (de B o C, o combinación)

Si se autoriza diseño: crear una **épica finita** con historias de código listas y sus autorizaciones específicas (permisos por rol con auditoría, flujo de corte/liquidación como evidencia inmutable, conciliación con diferencias explicables). Ninguna opción de este brief habilita por sí sola producción.

## Límites

Sin información real de clientas ni del salón; sin datos de consumo productivos; nada de esto toca Firebase/Vercel ni el catálogo público. El mapa técnico vive en las issues citadas (#124/#125/#128/#129/#135/#157/#184/#189/#202/#203/#205) — **no se propone un segundo ledger** de inventario, ventas o caja: el piloto se mide con los contratos existentes.
