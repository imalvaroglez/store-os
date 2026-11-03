# FER-04: clasificación y precios por clienta

La ficha de clienta registra por separado su clasificación (regular o emprendedora) y su nivel de precio de la tienda. Los registros existentes se interpretan como regular y sin nivel asignado; se aplica el nivel predeterminado de la tienda.

Las líneas nuevas toman el nivel de la clienta al seleccionar un producto. Una línea sin precio para ese nivel queda pendiente hasta que Fer capture un importe, incluido cero si es intencional. Los importes o niveles ajustados por Fer se marcan como manuales.

Al cambiar de clienta con productos ya capturados, se pregunta si conservar los importes, aplicar los precios de la nueva clienta o cancelar. Aplicar modifica solo las líneas automáticas y conserva los precios manuales. Abrir un pedido guardado mantiene sus precios. Si el nivel asignado se oculta o deja de existir, se solicita uno disponible para el pedido.

La clasificación y la asignación son manuales; no se aplica renovación ni vencimiento automático. La selección y el cálculo ocurren con los datos de tienda ya cargados. Guardar una ficha añade una escritura de clienta; no se crean servicios ni consultas adicionales.
