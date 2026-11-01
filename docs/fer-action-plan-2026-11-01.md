# Backlog vigente y plan de acción de Fer

Fecha de corte: 1 de noviembre de 2026, America/Mexico_City.
Alcance de esta revisión: organización documental. No autoriza implementación,
integración de PR, migraciones ni liberaciones.

## Fuente y estado comprobado

Esta es la vista vigente del plan; `docs/backlog.json` conserva todos los IDs,
el orden, el estado y los criterios. Los documentos del 28 de octubre y el
diagnóstico OLI se conservan como antecedentes, no como otra cola.

- GitHub consultado en esta sesión: main en
  `aa26233adf1cb35c29b9e0934c7aeb02716c53bd`.
- [CI de liberación](https://github.com/imalvaroglez/store-os/actions/runs/41333260485):
  ejecución manual del 1 de noviembre de 2026, 11:47, hora de Ciudad de México.
  build-test, rules-and-e2e, deploy-rules y deploy terminaron en success.
- Los despliegues GitHub Production 7476773740 (reglas) y 7476778775
  (aplicación) registran success para ese mismo SHA; aplicación completada a las 11:55.
- Esto acredita el commit liberado, no una prueba de cada recorrido de Fer ni
  la actualización de proyecciones históricas. No se consultaron datos productivos.
- Los cuerpos de algunos PR conservan frases de cuando estaban en draft.
  Para integración se usaron los campos actuales state/merged, no esas frases.
- El corte asistido de octubre sigue abierto en #115. Hay dos pedidos volcados
  a una copia del libro existente, pero no evidencia de un mes completo cerrado.
  Se mantiene como trabajo operativo independiente; no sustituye cobros ni cierres en la app.

## Qué ya está liberado y no se vuelve a construir

| Capacidad | Evidencia | Qué sigue pendiente |
| --- | --- | --- |
| Integridad de pedidos, reservas y recuperación de capturas | #90 integrado en el SHA liberado | Medir recargas/cuotas al ampliar históricos; no suponer resuelto todo el inventario futuro. |
| Línea nueva arriba y foco | #91 | Refinamiento de numeración estable y pila en #112. |
| Tipo de clienta y precio automático | #92 | Vigencia y renovación automática Iconic. |
| Revisión agrupada por categoría | #93 | Mantenerla al añadir imágenes y variantes. |
| Ticket en texto | #94 | PDF es evolución separada; no reabrir todo FER-08. |
| Gastos de surtido en compras | #110 | Reparto/costo completo en #114 y gastos de venta aún por definir. |
| Filtro público por acabado | #103 | Subcategorías reales, precedencia de agotado y variantes. La proyección antigua puede necesitar republicación aprobada. |
| Productos unificados, invitaciones y precios configurables | #41, #42, #43 integrados | Límites de recuperación de proyección pública se cruzan con #96. |
| Refresh, lockfile npm y recepción rápida | #39, #40, #50 integrados | No repetir por estados históricos del backlog. |
| Orden/filtros internos de productos | Evidencia de main reunida en #98 | #98 es reconciliación documental abierta, no otra feature. |

La prioridad de erradicar modo local permanece P0, pero su bloqueo histórico
cambió: #89–#94, #103–#107, #109 y #110 ya están integrados, y #108 ya está
cerrado sin integrar. Existe implementación en #111; requiere revisión y
aceptación conjunta con #96 para cubrir errores de escritura. No empezar otra
implementación ni cerrar esos PR desde este trabajo.

## Cola y secuencia de acción

P0 = integridad y operación urgente; P1 = operación diaria acordada;
P2 = siguiente ciclo; P3 = evolución posterior. El número priority del JSON
ordena dentro de la cola; done sale de la cola activa.
in-progress significa trabajo construido/en revisión, no autorización nueva.
Cada entrada del JSON contiene criterios; aquí se muestra la secuencia principal.

| Orden | Trabajo | Estado real y próximo paso | Dependencias / salida |
| --- | --- | --- | --- |
| 0 | Errores al guardar y eliminación del modo local | Revisar #96 y #111, ya construidos | Dependencias históricas satisfechas. Fallo visible, reintento y ninguna copia administrativa local; probar integración en dev. |
| Paralelo | Corte asistido de octubre | Continuar solo con fuentes y confirmaciones pendientes de #115 | No inventar pagos/costos/fechas ni declarar cerrado el mes. No bloquea las mejoras de captura. |
| 1A | Foto en líneas de pedido (FER-18) | Definición lista para spec dentro del futuro PR de código | Reutilizar imágenes existentes; conservar precios, foco, agrupación y ticket. Conciliar #112 al integrar. |
| 1B | Valores predeterminados de productos (FER-19) | Definición funcional lista; confirmar mecanismo por tienda al diseñar | Olivia: Publicado, pedir info y material Acero inoxidable; todo editable, sin modificar productos existentes. |
| 2 | Cobros/abonos y métodos combinados (FER-20 / OLI-036 / R06) | Diseño pendiente con ejemplo concreto confirmado | Base #90 y errores visibles. No esperar costo/ganancia/corte completo. Resolver saldos anteriores, corrección y excedentes. |
| 3 | Variantes administrativas (FER-12) | Sube de P3 a P1; parte del bloqueo ya resuelta | Mismo diseño, stock por color y selección al vender confirmados. Cerrar precio/foto, momento de reserva y transición de productos existentes. |
| 4 | Compras y gastos completos (FER-02) | Revisar primero #114, no reconstruir lo que contiene | Viajes/tickets, reparto y costo última compra ya propuestos. Confirmar alcance aceptado y separar empaque/entrega de venta pendiente. |
| 5 | Costo y ganancia por venta (FER-03) | Definición pendiente sobre la base final de compras | Costo histórico, gastos sin duplicar, devoluciones y separación de cobrado/ganado. |
| 6 | Mes, reparto y cierre (FER-15/16) | Reglas pendientes | Cobros + costos. 20/50/30 confirmado; fecha de atribución, préstamo, pérdidas, redondeo y reapertura pendientes. |
| 7 | Iconic, reposición y ranking (FER-05/09/17) | Después de operación diaria | #102 ya construye filtro Por surtir; avisos externos siguen separados y sujetos a costo cero. Ranking depende de su métrica, no obligatoriamente de todo el cierre contable. |
| 8 | Catálogo público y solicitudes (FER-10/11/13/14) | Revisar #99/#100 ya construidos cuando corresponda | No rehacer filtro #103. Separar jerarquía, variantes públicas, coherencia visual y solicitud sin recaptura. |

Trabajo complementario: #97 (migración adminStores) y #101 (usuarios de
plataforma) requieren revisión, no nueva construcción. #101 documenta un
riesgo de lectura de users por usuarios autenticados que debe resolverse antes
de liberar esa capacidad. #113 es herramienta operativa opcional, no requisito
de estas features: no ejecutar copia de datos. #95 está reemplazado por #110 y
no debe integrarse; su cierre corresponde al responsable. #98 se solapa con
esta reconciliación documental: coordinar su disposición sin cerrarlo aquí.
Privacidad permanece en cola con su revisión jurídica separada. Roles siguen congelados.

## Primera entrega definida: captura más sencilla

Objetivo: Fer identifica la pieza sin salir de la app y deja de repetir los
mismos campos al crear productos. Dos cambios lógicos, dos futuros PR desde
main, cada uno con su spec y evidencia. Ninguno se implementa en esta conversación.

### FER-18 — Foto en cada línea de pedido

1. Elegir un producto con foto muestra su portada junto a esa misma línea.
2. Cambiar de producto cambia la foto; borrar la selección elimina la anterior.
3. Producto sin foto, captura libre o imagen fallida muestran un espacio claro
   sin bloquear el guardado ni conservar la imagen de otra pieza.
4. Reabrir el pedido permite reconocer la foto disponible; no se promete
   conservar una foto histórica si el catálogo cambia.
5. Funciona en móvil de 390 px y escritorio; 50 líneas no provocan
   desbordamiento ni alteran cantidades, precios, totales, identidad o foco.
   La revisión por categoría sigue siendo usable.
6. Reutilizar la portada existente. No subir/copiar imágenes ni añadir consultas
   Firestore por línea; carga diferida y caché para limitar descargas.
7. Conciliar el formulario con el refinamiento #112. Su integración no es
   requisito para definir la foto, pero el resultado combinado debe probarse.

Salida: pedido de varias piezas con y sin foto, cambio de selección,
guardar/reabrir, revisión por categoría y captura móvil verificados en dev.

### FER-19 — Valores predeterminados al crear productos de Olivia

1. Nuevo producto: Publicado (visible en el catálogo), Permitir pedir info
   activado, Novedad y Destacado desactivados, material Acero inoxidable.
2. Todos los campos siguen editables; Fer puede elegir Borrador.
3. Editar un producto existente respeta los valores guardados, incluso vacío,
   false o borrador. No hay actualización masiva ni publicación retroactiva.
4. Se conservan las validaciones para publicar. Si falta un dato obligatorio,
   el mensaje explica qué completar; Fer puede guardar explícitamente como borrador.
5. El material corresponde a Olivia: el diseño elegirá una configuración por
   tienda u otro mecanismo explícito que preserve aislamiento, sin identificar
   tiendas por su nombre visible ni imponer acero inoxidable a otras tiendas.
   No abrir un sistema general de plantillas.
6. Delimitar el formulario individual de Productos. La creación rápida y por
   lote de Compras en #114 conserva su alcance hasta acordar su comportamiento;
   no extender automáticamente la publicación a productos incompletos de compra.
7. Guardar/reabrir conserva valores y la proyección pública refleja solo lo
   efectivamente publicado.

Salida: creación, cambios manuales, guardado como borrador, edición existente
y contraste con otra tienda en dev. Sin servicios nuevos; mismos documentos de
producto/proyección y, si se usa, configuración de tienda cargada una vez.

## Cobros: alcance confirmado y decisiones restantes

Confirmado por Fer: entrar al pedido para registrar efectivo, transferencia o
ambos, sin depender de un estado logístico. Caso: transferencia $1,010 +
efectivo $200 = recibido $1,210. El saldo depende del total real del pedido;
el ejemplo no afirma que $1,210 sea ese total.

Propuesta para cerrar diseño: cobros individuales con fecha, método y monto;
permitir varios en diferentes momentos, mostrar recibido y saldo, evitar
duplicados por reintento y conservar evidencia de correcciones.
Es registro de cobros recibidos, no procesamiento de pagos.

Falta acordar: cómo representar el anticipo acumulado anterior sin inventar
método/fecha; correcciones y devoluciones; excedentes; edición de un pedido ya
pagado y confirmación del flujo de abonos en fechas distintas.
No se bloquea esto con todas las decisiones de reparto de ganancia.

Salida: ejemplo combinado exacto, pago de $400 sobre $1,000 deja $600, segundo
abono en otra fecha, reintento sin duplicar y pedido con anticipo heredado.

## Variantes: lo resuelto no se vuelve a preguntar

Confirmado: un mismo diseño tiene dorado/plateado, cada color tiene existencia
propia y se elige el vendido. Dos dorados y un plateado, vender un dorado deja
uno dorado y uno plateado bajo el evento de stock acordado.

Pendiente: compartir o separar precio/foto/costo/clave; convertir o agrupar
productos existentes sin perder IDs; disponibilidad pública de opción agotada;
y evento de reserva/descuento. La cotización y la entrega no deben descontar
dos veces la misma pieza.

Separar entrega administrativa P1 de selector público posterior. No se elige
modelo de datos ni se migran existencias en este plan.

## Criterios para retomar implementación

- Revisar el trabajo existente según el orden anterior y comprobar conflictos
  contra main; los agentes no hacen merge ni cierran PR ajenos.
- Resolver solo las decisiones necesarias para la entrega elegida.
- Mantener Auth + Firestore, aislamiento multitienda, español de México,
  sistema de diseño, móvil y costo cero.
- Estimar lecturas/escrituras y descargas por entrega; fotos reutilizan datos
  ya cargados y la caché, cobros/variantes requieren estimación al diseñarse.
- Antes del futuro PR de código: typecheck, test y build; E2E proporcional y
  Preview local de producción contra dev/emuladores. Los checks de esta
  reconciliación documental no son aceptación de las features.
- Tras revisión humana, liberar únicamente el mismo commit aprobado en main.
  Registrar aparte cualquier republicación de proyecciones requerida; nunca
  ejecutarla por inferencia durante planificación.

## Validación de esta reorganización

- 41 entradas en JSON; IDs anteriores conservados, sin duplicados, con criterios
  por entrada y dependencias existentes sin ciclos.
- Enlaces documentales y rutas vigentes comprobados; la referencia inexistente
  de la spec de roles se conserva solo como dato histórico, no enlace operativo.
- Typecheck, 419 pruebas y build en verde. Se omiten seis pruebas que requieren
  emulador. Build local usa store-os-dev; prerender omitido sin credenciales.
- Diff limitado a documentación y backlog; no cambia aplicación, reglas,
  workflows ni datos. No se ejecuta E2E nuevo para este cambio documental.

## Inventario de PR consultados

Fotografía de metadatos GitHub al corte; no promete CI vigente ni aceptación
funcional de todas las ramas.

| PR | Alcance | Estado GitHub |
| --- | --- | --- |
| [#115](https://github.com/imalvaroglez/store-os/pull/115) | feat: preparar captura de WhatsApp para el corte asistido de octubre | Abierto |
| [#114](https://github.com/imalvaroglez/store-os/pull/114) | feat: compras por viaje, costo completo de inventario y correcciones de captura | Abierto |
| [#113](https://github.com/imalvaroglez/store-os/pull/113) | chore: herramienta para copiar datos prod→dev (ejecutada por humano) | Abierto |
| [#112](https://github.com/imalvaroglez/store-os/pull/112) | feat: orden de captura estable con vista de pila y animación (refinamiento OLI-011) | Abierto |
| [#111](https://github.com/imalvaroglez/store-os/pull/111) | chore: retire local admin persistence | Abierto |
| [#110](https://github.com/imalvaroglez/store-os/pull/110) | feat: registra gastos de surtido en Compras (FER-01) | Integrado |
| [#109](https://github.com/imalvaroglez/store-os/pull/109) | fix: aislar Firebase dev y proteger liberaciones de producción | Integrado |
| [#108](https://github.com/imalvaroglez/store-os/pull/108) | fuera de integración: administración sin sesión | Cerrado sin integrar |
| [#107](https://github.com/imalvaroglez/store-os/pull/107) | docs: registrar bloqueos de Iconic y ranking (FER-05/17) | Integrado |
| [#106](https://github.com/imalvaroglez/store-os/pull/106) | docs: reunir bloqueos financieros del backlog FER | Integrado |
| [#105](https://github.com/imalvaroglez/store-os/pull/105) | docs: registrar decisiones pendientes de solicitudes (FER-14) | Integrado |
| [#104](https://github.com/imalvaroglez/store-os/pull/104) | docs: registrar decisiones pendientes de variantes (FER-12) | Integrado |
| [#103](https://github.com/imalvaroglez/store-os/pull/103) | feat: filtrar catálogo por acabado (FER-11) | Integrado |
| [#102](https://github.com/imalvaroglez/store-os/pull/102) | feat: filtrar productos por surtir en el catálogo | Abierto |
| [#101](https://github.com/imalvaroglez/store-os/pull/101) | feat: agregar vista de usuarios para super_admin | Abierto |
| [#100](https://github.com/imalvaroglez/store-os/pull/100) | feat: agregar acceso visual por categoría al catálogo | Abierto |
| [#99](https://github.com/imalvaroglez/store-os/pull/99) | feat: editar el catálogo de Olivia desde la vitrina | Abierto |
| [#98](https://github.com/imalvaroglez/store-os/pull/98) | docs: reconcile completed backlog items | Abierto |
| [#97](https://github.com/imalvaroglez/store-os/pull/97) | feat: migrar tiendas sin documento adminStores | Abierto |
| [#96](https://github.com/imalvaroglez/store-os/pull/96) | fix: avisar cuando falla una escritura de Firestore | Abierto |
| [#95](https://github.com/imalvaroglez/store-os/pull/95) | superseded: FER-01 continúa en #110 | Abierto |
| [#94](https://github.com/imalvaroglez/store-os/pull/94) | feat: compartir el detalle de un pedido | Integrado |
| [#93](https://github.com/imalvaroglez/store-os/pull/93) | feat: revisar pedidos por categoría | Integrado |
| [#92](https://github.com/imalvaroglez/store-os/pull/92) | feat: asignar precios por clienta en pedidos | Integrado |
| [#91](https://github.com/imalvaroglez/store-os/pull/91) | feat: agilizar la captura de pedidos largos | Integrado |
| [#90](https://github.com/imalvaroglez/store-os/pull/90) | fix: proteger pedidos e inventario y recuperar capturas | Integrado |
| [#89](https://github.com/imalvaroglez/store-os/pull/89) | feat(E0): ensayo del Excel, reglas de apertura y paquete de decisiones | Integrado |

