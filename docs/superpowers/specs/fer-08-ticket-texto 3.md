# FER-08: compartir el detalle de un pedido

Fer abre el detalle de un pedido guardado y copia un texto para compartir manualmente. El detalle usa los datos guardados: tienda, referencia, clienta, estado, líneas agrupadas por categoría, cantidades, precios unitarios, subtotales, total, anticipo y saldo. Los pedidos sin categoría guardada muestran “Sin categoría”. Notas internas, costos y ganancia no se incluyen.

Los nuevos pedidos guardan el nombre de la clienta como snapshot. Al editar sin cambiar de clienta se conserva el nombre guardado. Los pedidos antiguos usan el nombre disponible. No se asigna un folio nuevo ni se envía un mensaje automáticamente.

Los importes se calculan por línea en centavos enteros con redondeo de mitad hacia arriba. El total es la suma de las líneas redondeadas. Los precios unitarios heredados conservan su precisión visible; los registros no se reescriben de forma masiva. Si un anticipo es mayor al total, se muestra la diferencia. Un importe fuera del rango seguro impide guardar y muestra una indicación.

El texto siempre se muestra seleccionable. Si el portapapeles no está disponible, Fer recibe la indicación para copiar manualmente. Esta acción no añade lecturas, escrituras ni servicios cloud.
