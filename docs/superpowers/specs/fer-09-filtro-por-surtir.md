# FER-09: filtro de productos por surtir

## Alcance de esta entrega

Agregar al catálogo interno un filtro **Por surtir** para tiendas con inventario.
Incluye productos agotados y productos con existencia igual o menor al umbral
`lowStockAt` configurado en cada producto. El filtro se combina con la categoría,
conserva el orden seleccionado y se limpia junto con los demás filtros.

La lista se calcula sobre los productos que la aplicación ya cargó. No escribe
en Firebase ni agrega lecturas. No se envían mensajes ni se crean avisos
persistentes.

## Criterios de aceptación

- Solo aparece en tiendas de inventario.
- Incluye existencias cero o negativas aunque no haya umbral configurado.
- Incluye existencias positivas cuando `quantityOnHand <= lowStockAt`.
- Excluye productos sin cantidad o por encima del umbral.
- Puede combinarse con categoría; **Limpiar** restablece ambos filtros.
- El estado se indica con `aria-pressed` y componentes/tokens del sistema de diseño.

## Bloqueador documentado para avisos externos

FER-09 también pide avisos que no se repitan por cada visita y prefiere WhatsApp.
Antes de automatizarlos faltan umbral inicial, momento de aviso, frecuencia y
comportamiento después de una reposición o ajuste de inventario. También hay que
comprobar que el canal cabe en la restricción de cero costos. Esta entrega no
sustituye WhatsApp por otro canal ni afirma que ya existan avisos automáticos.

## Ambientes y validación

- Pruebas unitarias locales no conectan a Firebase.
- Las reglas y E2E, si aplican por cambios futuros, deben usar exclusivamente
  `store-os-demo` (emulador).
- Preview usa `store-os-dev`; producción es `store-os-f7cf8` y no se toca.
