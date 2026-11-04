# FER-02/03/15/16 · Bloqueos del flujo financiero

Actualización del 30 de octubre: para la adquisición de inventario, Álvaro
confirmó repartir transporte y envío por cantidad de piezas y usar el costo
completo de la última compra, con varios proveedores por viaje. La
[entrega del showcase](2026-10-30-showcase-purchase-fixes-design.md) define
el alcance implementado; las demás reglas de ventas, empaques y cierres
continúan pendientes donde se indica abajo.

## Reglas confirmadas que sí se conservan

- El reparto vigente de ganancia es 20% para pagar la inversión recibida, 50% para Fer y 30% para Olivia. No es una transferencia automática.
- Los cortes cubren del día 1 al último día del mes. Una venta del día 1 pertenece al mes nuevo.
- Para un ejemplo de compra, $44 entre 100 piezas da $0.44 por pieza.
- El Excel de ventas muestra reglas y diferencias históricas; el reparto 15/50/35 del inventario no reemplaza la regla vigente de ventas.

## Bloqueo FER-02: asignar gastos y empaques

Acordar antes de calcular costo por pieza:

1. Para transporte y envío de adquisición, ya se confirmó cantidad de piezas. Otros repartos de venta o entrega requieren definir su base; no trasladarles automáticamente esa regla.
2. Cómo distribuir empaques individuales y bolsas compartidas cuando quedan fracciones de centavo. El total asignado debe conservar exactamente el total original.
3. Qué hacer con piezas que se agregan o quitan de una compra después de registrar el gasto.
4. Cómo asignar viajes que combinan surtido, entrega y actividades ajenas al negocio.
5. En qué operación y fecha se captura un gasto tardío, y cómo evitar sumarlo otra vez.

FER-01 registra gastos con la compra, pero por sí solo no define ni calcula esta distribución.

## Bloqueo FER-03: costo y ganancia por venta

Depende de FER-02 y requiere acordar:

- costo histórico por unidad al vender y correcciones; el costo de inventario para las nuevas recepciones ya se acordó como costo completo de la última compra, sin promediarlo con las existencias anteriores;
- fecha que atribuye la venta y el costo si el pedido se crea, paga y entrega en meses distintos;
- tratamiento de abonos, cancelaciones, cambios y devoluciones;
- diferencia entre venta registrada, efectivo cobrado y ganancia distribuible.

No se debe reemplazar el Excel hasta cuadrar un mes representativo con Fer.

## Bloqueo FER-15: reparto 20/50/30

La proporción ya está confirmada, pero FER-03 no produce todavía una base de ganancia distribuible. Además falta definir el caso en que el 20% calculado no cubra la inversión pendiente, si esa deuda continúa al siguiente corte, y cómo registrar pagos previos, pérdidas, operaciones corregidas y centavos sobrantes. El sistema solo calcularía y dejaría evidencia; no transferiría dinero.

## Bloqueo FER-16: corte mensual

Acordar qué fecha contable determina el mes (venta, pago o entrega), zona horaria de la tienda, pagos parciales, cambios posteriores, devoluciones y si un corte se congela o puede reabrirse. Depende de costo/ganancia y reparto definidos en FER-03 y FER-15.

## Orden para continuar

FER-02 → FER-03 → FER-15 → FER-16. Cada paso necesita ejemplos numéricos aprobados contra el Excel de Fer antes de codificar la regla correspondiente. Hasta entonces, conservar los registros y cálculos actuales; no inferir un prorrateo ni alterar históricos.

## Restricciones

- No importar ni modificar datos históricos por inferencia.
- No cambiar repartos vigentes ni operar transferencias.
- Sin escrituras a Firebase en este registro de decisiones.
