# Análisis de migración a variantes de color (#124, opción A futura)

**Estado: análisis. Nada de esto se ejecuta hoy.** La transición vigente es
la opción B (decisión del PO 2026-11-09): los productos existentes no se
tocan; solo los diseños nuevos usan variantes. Este documento describe qué
exigiría la unión manual caso por caso (opción A) cuando Fer la pida.

## Qué implica "unir en diseño" un grupo de productos existentes

Dados N productos (p. ej. «Anillo Sol Dorado» y «Anillo Sol Plateado») que en
realidad son colores de un mismo diseño:

1. **Elegir el diseño anfitrión** (o crear uno nuevo): nombre, claves,
   fotos, categorías, precios por nivel. Los precios de los N productos
   deben coincidir; si difieren, es una decisión comercial de Fer antes de
   unir.
2. **Derivar cada color**: color (desde el nombre o el campo `finish`),
   clave (la del producto origen o sufijo nuevo), costo (el costo del
   origen), existencia (la del origen), fotos (la galería del origen).
3. **Historial**: los pedidos y compras pasados referencian `productId` de
   cada producto origen. La unión NO reescribe historia: los pedidos
   antiguos siguen apuntando a su producto; el diseño nuevo nace con su
   propia identidad. Ganancia y reportes por producto histórico quedan como
   estén (los orígenes se archivan, no se eliminan — sus evidencias de
   dinero y stock lo exigen).
4. **Catálogo público**: archivar los orígenes los saca del catálogo; el
   diseño nuevo publica sus colores. La proyección se republica.
5. **Existencias negativas o en cuarentena** en un origen: deben resolverse
   ANTES de unir (la unión suma existencias; un negativo contamina el color).

## Herramienta propuesta (cuando se autorice)

Asistente en Productos: «Unir estos N productos en un diseño con colores» —

- Paso 1: elegir los N orígenes (búsqueda; el sistema valida misma tienda,
  categorías compatibles, precios por nivel idénticos o decisión explícita
  de Fer por nivel).
- Paso 2: previsualización del diseño resultante: un color por origen, con
  su clave/costo/existencia/fotos editables antes de confirmar.
- Paso 3: una transacción: crea el diseño, archiva los orígenes (con sus
  existencias a cero y nota automática «unido a X»), publica la proyección.
  Sin reescribir pedidos, compras ni historial.
- Costo de operación: ~2 minutos por diseño para Fer; el asistente evita
  captura repetida (todo se hereda editable).

## Riesgos y salvaguardas

- **Precios distintos entre orígenes**: bloquea hasta decisión de Fer.
- **Existencia negativa/cuarentena**: bloquea hasta resolver.
- **Claves duplicadas**: el sufijo debe ser único dentro del diseño.
- **Doble conteo**: los orígenes se archivan con existencia 0; el diseño
  nace con la suma exacta de los orígenes activos.
- **Reversibilidad**: la unión no es reversible automáticamente (los
  orígenes conservan su historial, pero su existencia ya vive en el diseño);
  el asistente debe mostrarlo antes de confirmar.
