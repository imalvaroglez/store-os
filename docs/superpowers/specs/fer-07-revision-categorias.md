# FER-07: revisar pedidos por categoría

En el editor de pedidos, Fer puede alternar entre Capturar y Revisar por categoría. La revisión agrupa por primera aparición de categoría, conserva el orden dentro de cada grupo, mantiene líneas repetidas por separado y muestra al final las líneas sin categoría. Cada línea permite volver a editarla, con foco en Producto.

Al seleccionar un producto se conserva en la línea una copia de la identidad y el nombre de su categoría principal. Cambios posteriores del catálogo no reescriben la categoría de líneas guardadas. Las líneas heredadas que no tienen esa copia y los productos libres se muestran como “Sin categoría”; no se inventan datos históricos.

La vista opera sobre el estado del formulario y no realiza consultas ni escrituras adicionales. Las pruebas cubren agrupación, edición, conservación de snapshots, guardado y navegación móvil y escritorio.
