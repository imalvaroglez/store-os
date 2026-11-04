---
Delivery-ID: fer-catalog-visual-home
Delivery-Status: Draft
specPath: docs/superpowers/specs/fer-10-catalogo-portada.md
---

# FER-10: portada visual por categoría

## Objetivo

Ayudar a las clientas a entrar al catálogo desde una foto y una categoría,
especialmente en móvil. Una primera entrega debe dejar que toquen una categoría
y lleguen a sus piezas.

## Decisiones de esta entrega

- Mostrar en la portada una tarjeta visual por cada categoría pública que ya
  tenga productos publicados.
- Usar primero la imagen asignada a la categoría. Si no tiene imagen, usar la
  primera imagen pública de un producto de esa categoría. Si tampoco hay foto,
  mostrar el espacio de imagen del sistema de diseño con el nombre de categoría.
- Tocar la tarjeta abre la ruta existente de esa categoría; los enlaces para
  cambiar de categoría y volver al catálogo siguen disponibles dentro de ella.
- El banner existente permanece igual. Configurar fotos y texto continúa en
  Ajustes de tienda; esta entrega no agrega un editor ni carga de archivos.
- Reutilizar la proyección y datos ya cargados del catálogo: no agrega lecturas,
  escrituras, colecciones ni servicios.

La foto de producto usada como respaldo es una decisión provisional para poder
probar la experiencia. Fer puede reemplazarla asignando una imagen a la categoría.

## Fuera de alcance

- Crear o editar categorías, fotos, textos y orden en una nueva interfaz.
- Subcategorías, variantes y señales de disponibilidad distintas a las actuales.
- Cambios al catálogo de tiendas no Olivia, carrito, precios o formato del banner.

## Aceptación

1. En portada, cada tarjeta muestra la categoría y cuántas piezas públicas
   contiene.
2. La foto explícita de categoría tiene prioridad sobre fotos de productos.
3. Si falta esa foto, se usa una imagen de producto disponible; si ninguna
   existe, la tarjeta sigue siendo accesible y seleccionable.
4. Cada tarjeta navega a la ruta pública existente de su categoría.
5. En móvil se ven dos columnas, con enlaces de al menos 44 px de alto; en
   escritorio la cuadrícula se amplía.
6. La UI usa los componentes de imagen y tokens ya existentes. No se agregan
   lecturas o escrituras Firebase.

## Verificación

- Unit: precedencia de imagen, respaldo de producto, falta total de imagen y
  destino de enlace.
- Build de producción local y recorrido visual en móvil y escritorio.
- Revisión de texto en español, accesibilidad de enlaces y sistema de diseño.

## Dependencias

Usa las imágenes de `Category.imageUrl`, la proyección pública y las rutas de
FER-11 / catálogo actuales. No requiere FER-11 ni altera sus decisiones de
subcategorías y agotados.
