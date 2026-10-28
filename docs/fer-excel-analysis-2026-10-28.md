# Olivia: reglas observadas en el Excel de Fer

Fuente: archivo `Ventas .xlsx` compartido por Álvaro desde su escritorio el
28 de octubre de 2026. Análisis de lectura, sin modificar el libro. Las celdas
y sus textos se trataron como datos, no como instrucciones.

Este documento complementa el [backlog de la entrevista](fer-backlog-2026-10-28.md).
Describe lo que hace el archivo; no convierte automáticamente sus fórmulas en
reglas aprobadas para Store OS. No se incorpora el libro ni la lista de clientas
al repositorio.

## Confirmación posterior de Álvaro

El 28 de octubre de 2026 Álvaro confirmó la regla vigente sobre la ganancia:
**20% para el inversionista, como pago de la inversión recibida; 50% para Fer;
30% para Olivia**. El reparto 15/50/35 de Inventario se conserva como hallazgo
del archivo, no como alternativa para la nueva implementación. No se confirmó
una fecha retroactiva ni se autorizó modificar los cortes o el Excel.

Las definiciones restantes se revisarán con Fer al trabajar en cada entrega.
Los errores de fórmulas quedan documentados para evitar reproducirlos en Store
OS; el archivo fuente permanece sin cambios. Álvaro autorizó compartir este
análisis en el PR #88 sin adjuntar el libro ni los nombres de las clientas.

## Estructura y significado

| Hoja | Evidencia | Lectura para el diseño |
| --- | --- | --- |
| Inventario | A3:U3; E5:U11 | Cantidad comprada, costo total, costo unitario con Packing, tres precios y ganancia/reparto por cada precio. |
| Ventas Ago - Sep | A2:M2; filas 3:93 | Ventas de dos meses en una hoja, con clienta/fecha/método de pago agrupados en celdas combinadas, detalle y subtotales de pedidos. |
| Ventas Oct | A2:P2; detalle hasta fila 38 y fórmulas hasta fila 50 | Agrega Packing, Envío y Estatus a las ventas. Hay operaciones pagadas, no pagadas y sin estatus. No hay una fila de corte mensual total en esta hoja. |

En ventas, las columnas Precio y Costo no pueden interpretarse automáticamente
como valores unitarios. En `Ventas Ago - Sep!F48:I48`, una cantidad de cinco
usa `H48=65*5` y resta el costo de esa línea. `Ventas Oct!F13:K13` muestra dos
piezas con precio total de línea, costo total y Packing de dos pesos. Hay que
confirmar con Fer la semántica de todas las líneas de varias piezas antes de
importar o mapear cantidades. No multiplicar por cantidad un subtotal que ya la
incluye.

Los bloques combinados sirven para expresar un pedido, pero no proporcionan
un identificador estable de pedido/clienta. La estructura no registra las
reventas externas de las emprendedoras. No basta para afirmar quién vendió más
a sus propias clientas ni para determinar quién participa en FER-17.

## Reglas observadas y puntos de contraste

1. **El nombre es Girly.** Aparece en `Inventario!H3` y en el nivel de precio de
   las hojas de ventas. Corrige la transcripción inicial “Gibly”; no implica
   renombrar automáticamente datos de la aplicación.
2. **Costo unitario de inventario:** `Inventario!E5=D5/C5+F5`. Packing se suma
   después de dividir el costo de compra entre la cantidad. F contiene $2.83
   en 164 filas del rango F5:F176, incluidas filas con datos de compra vacíos.
   Es un valor capturado, no una fórmula que explique cómo se compone. Hay que
   preguntar si incluye empaque, envío o transporte antes de sumar los gastos
   de FER-02 y contarlos por duplicado.
3. **Ganancia en las ventas antiguas:** `Ventas Ago - Sep!J3=H3-I3`. En octubre
   se vuelve `Ventas Oct!L5=H5-SUM(I5:K5)`: resta costo, Packing y Envío a la
   venta de la línea. Envío se captura manualmente; el libro no prueba cuál es
   su denominador de reparto ni si es surtido o entrega a clienta.
4. **Reparto observado en todas las líneas de venta:** inversión 20%, salario
   50%, fondo de marca/recompra 30%. Evidencia: `Ventas Ago - Sep!K3:M3` y
   `Ventas Oct!M5:O5`. Es reparto sobre ganancia, no sobre el ingreso completo.
5. **Inventario usa otro reparto:** inversión 15%, salario 50%, fondo 35%,
   por ejemplo `Inventario!M5:U5`. La confirmación posterior establece que rige
   20/50/30. Queda por aclarar si la diferencia del archivo es histórica, una
   simulación o una inconsistencia, y cómo conservar el significado de cortes
   anteriores sin recalcularlos silenciosamente.
6. **Ganancia calculada no significa dinero cobrado:** en `Ventas Oct!P22:P25`
   aparece NO PAGADO y en L22:O25 se calculan ganancia y reparto igualmente.
   No hay condición de pago en esas fórmulas. Falta acordar cuándo ese importe
   se puede distribuir y cómo tratar abonos y estatus sin completar.
7. **Meses:** `Ventas Ago - Sep!C3:C10` contiene fechas de agosto y a partir de
   C12 hay fechas de septiembre; H93:M93 consolida ambas en “TOTALES DEL MES”.
   El nuevo corte por mes calendario no debe copiar esa agrupación histórica.
8. **Precios calculados y manuales conviven:** `Inventario!G6:I6` usa múltiplos
   del costo, G7:I7 usa otros y G5:I5 contiene precios manuales. No se desprende
   una fórmula universal de precio ni una regla automática para obtener Iconic.
9. **Precisión:** las fórmulas conservan fracciones de centavo, por ejemplo
   `Ventas Ago - Sep!L93`. Acordar redondeo por línea/corte y asignación del
   residuo para que los tres repartos sumen exactamente la ganancia distribuida.

## Hallazgos que no debemos copiar como reglas

- **Subtotal incompleto:** `Ventas Ago - Sep!K28=SUM(K23:K27)` omite las filas
  12:22 del pedido. El rango completo K12:K27 suma $83.08; el subtotal guardado
  es $22.95. La diferencia es $60.13. K93 calcula el 20% desde J93 y no usa K28,
  por lo que este error de subtotal no demuestra un error en ese total general.
- **Divisiones con cantidad vacía:** E68:E87 de Inventario divide entre celdas
  C vacías. Hay resultados guardados `#DIV/0!` en esas filas y sus ganancias,
  y en E178. Distinguir dato incompleto de costo cero.
- **Total de inventario sin una base de ganancia clara:** J178 suma F178:I178
  (Packing y los tres niveles de precio) y después M178/N178 reparten J178.
  O178 usa `=K178*0.5` aunque K178 está vacío y la columna de fondo del detalle
  usa 35%. Esa fila no es una base fiable para el reparto de ventas del mes.
- **Datos faltantes o ambiguos:** hay costos cero, estatus sin completar y
  nombres de producto/clienta capturados manualmente. Son preguntas de calidad
  de datos; no corregir, fusionar ni completar registros por suposición.

## Efecto en el backlog

| Candidatos | Qué queda más claro | Qué sigue abierto |
| --- | --- | --- |
| FER-01/02/03 | Compra por cantidad, costo de línea y costo unitario son conceptos distintos; Packing puede estar incluido en el costo. Octubre separa gastos adicionales. | Composición de $2.83, gasto de surtido vs entrega, base de reparto, conservación de costo histórico y excepciones. |
| FER-04/05 | Etiqueta Girly confirmada en el archivo. Los tres precios ya se usan en ventas. | Clasificación de emprendedora, umbral y evento que activa/renueva Iconic cada 30 días. |
| FER-08 | Las ventas ya se agrupan manualmente por clienta/fecha; el ticket debe expresar cantidad, precio unitario y subtotal sin ambigüedad. | Formato de entrega, identificación del pedido y saldo/abonos. |
| FER-15 | Regla vigente confirmada: 20% pago de inversión, 50% Fer, 30% Olivia, sobre ganancia. | Tratamiento histórico del 15/50/35, préstamo, pérdidas, redondeo y disponibilidad de efectivo. |
| FER-16 | El archivo permite estudiar la lógica del corte; el agrupamiento agosto–septiembre difiere de la nueva petición. | Fecha de atribución, pagos parciales, ajustes, cierre y reapertura. |
| FER-17 | Hay compras de clientas a Olivia, no registros de sus reventas. | Base y participantes del ranking, empates, operaciones pendientes y canal/fecha del aviso. |

## Validación realizada

Se leyeron las tres hojas, sus encabezados, fórmulas y valores guardados con
Python del runtime de documentos. Se contrastó independientemente la resta de
ganancia en 52 líneas con producto/cantidad de agosto–septiembre y 30 de octubre,
sin diferencias con los resultados guardados. Las fórmulas de reparto de esas
82 líneas usan consistentemente 20/50/30. Se revisaron aparte los subtotales y
las fórmulas de inventario señaladas arriba.

No se recalculó el libro completo en Excel ni se validaron sus resultados contra
pagos reales, inventario físico o datos de Store OS. Las sumas del archivo no
deben presentarse como un cierre definitivo ni como un ranking de ganadoras.

## Próximas definiciones con Álvaro y Fer

El reparto vigente 20/50/30 ya está confirmado. Al trabajar cada entrega,
revisar con Fer qué integra Packing de $2.83 y qué representa Envío; si el corte
reparte ganancia de ventas registradas o de cobros efectivos; cómo interpretar
líneas de varias piezas; y si el top 3 compara compras a Olivia. La fecha de
aplicación histórica y el tratamiento de fórmulas anteriores siguen abiertos.
Con esas respuestas podemos diseñar cálculos con ejemplos reproducibles sin
arrastrar errores del libro.
