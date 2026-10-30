# FER-06: captura rápida de pedidos

Fer captura pedidos largos y necesita que cada línea nueva quede visible sin desplazarse por las anteriores.

Al agregar una línea, se inserta al inicio, se enfoca el campo Producto y se desplaza a una posición visible sin animación. Las líneas anteriores conservan sus valores y el total sigue correspondiendo a la captura. Funciona en móvil y escritorio mediante los componentes del sistema de diseño.

La operación modifica únicamente el estado local del formulario: no añade lecturas, escrituras ni servicios. Validar con 50 líneas, teclado, foco y valores conservados; ejecutar typecheck, tests, build y el recorrido e2e aplicable.
