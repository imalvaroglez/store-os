---
Delivery-ID: fer-catalog-cohesion
Delivery-Status: Draft
specPath: docs/superpowers/specs/fer-13-catalogo-cohesion.md
---

# FER-13: recorrido visual coherente del catálogo

## Objetivo

Que la clienta pueda pasar de la portada a una categoría, encontrar una pieza y
revisar su bolsa sin perder contexto visual ni de navegación, en móvil y
escritorio.

## Alcance de esta iteración

- La portada organiza la entrada por categorías con imágenes, nombre y cantidad
  de piezas visibles (FER-10).
- La página de categoría conserva enlaces para regresar a todas las piezas y
  cambiar de categoría.
- Búsqueda y orden siguen disponibles en el catálogo y respetan la categoría
  elegida.
- La bolsa mantiene las piezas al cambiar de ruta y vuelve a un control visible
  al cerrarse.
- Se conserva el acabado en tarjetas y el filtro por acabado de FER-11 cuando
  esa entrega se integre; este PR no cambia el significado de subcategoría ni
  la prioridad de la señal “Agotado”.
- Se reutilizan las rutas, componentes y estilos Olivia existentes; no agrega
  lecturas, escrituras, colecciones, servicios ni carga automática de imágenes.

## Aceptación

1. Desde la portada, una tarjeta de categoría abre su página.
2. La página conserva búsqueda y acceso a “Todas las piezas”.
3. La clienta puede filtrar resultados por búsqueda, agregar una pieza y verla
   en la bolsa.
4. Cerrar la bolsa y volver al catálogo mantiene la pieza y no pierde la ruta.
5. El recorrido funciona a 390 px sin desbordamiento horizontal; el diseño
   conserva la cuadrícula adaptable en escritorio.
6. La identidad visual se mantiene en las pantallas con estilos de `olivia.css`,
   respetando el sistema de componentes, tipografía, colores, foco y áreas de
   toque existentes.

## Dependencias y revisión

FER-10 entrega las tarjetas de portada. FER-11 añade el filtro por acabado en
una rama independiente. Al preparar la Preview integrada, recorrer ambas
entregas juntas en móvil y escritorio y pedir a Fer revisar las fotos y la
sensación visual. Los cambios de fotos o jerarquía se iteran con ese feedback;
la primera prueba no espera una dirección de arte definitiva.

## Verificación

- E2E con Firebase Emulator: portada → categoría → búsqueda → bolsa → regreso.
- Recorrido en 390 px y 1280 px y comprobación de que no haya desbordamiento
  horizontal.
- No se accede a Firebase remoto. La Preview/Development futura corresponde a
  `store-os-dev`; producción `store-os-f7cf8` queda fuera de esta entrega.
