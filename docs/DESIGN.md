# Guía de diseño del panel

Cómo se compone una vista del panel de Store OS. La referencia viva es la
vista **Pedidos**: si una pantalla nueva no se ve como su familia, está mal.
Esta guía existe porque llegaron a convivir dos anchos de contenido y bloques
pegados — eso no vuelve a suceder (el gate del design system lo impide).

## Principio rector

**El área principal es el recurso.** Las vistas de información fluyen a ancho
completo del área principal; el espacio libre se usa en lo que se debe usar
(datos, acciones), nunca en relleno ni en columnas vacías. Las únicas
excepciones son los **formularios**, que se auto-limitan a `max-w-5xl`
centrado porque una forma de captura de 1500px es hostil de leer y llenar.

Decisión del dueño (2026-09-01): Pedidos fija el estándar de espaciado; la
máxima es aprovechar el espacio disponible.

## Estándar UX: fricción operativa mínima

Una vista es exitosa cuando la persona dueña o colaboradora **completa su tarea con el menor esfuerzo posible**, sin perder control sobre dinero, inventario, permisos o decisiones. No digitalices pasos innecesarios.

Antes de cambiar un recorrido, define caso habitual y excepciones, qué información ya conoce StoreOS y cuántas interacciones requiere completar la tarea: **taps/clics, scrolls, cambios de foco, recapturas, retrocesos y confirmaciones**. Compara antes/después con fixtures representativos cuando sea viable; nunca conviertas números imaginados en mediciones. Un paso eliminado que causa errores no es una mejora.

- **Frecuencia primero:** prioriza el trabajo repetitivo (compras, artículos, pedidos, cobros, entregas). Acción principal accesible; excepción con detalle cuando se necesite.
- **Captura mínima:** reutiliza datos, recuerda decisiones confirmadas, facilita revisión/edición por lote y no obliga a copiar información entre pantallas.
- **Colecciones navegables (mandato del PO, 2026-11-09):** una vista que maneja conjuntos significativos de registros ofrece desde el inicio búsqueda, filtros relevantes, ordenamiento, estados, selección múltiple o visualización progresiva — nunca una lista interminable sin controles. El diseño se prueba con una tienda nueva, una con pocos productos y una con cientos de registros; el e2e no se limita al escenario conveniente de 1–2 objetos.
- **Selección masiva revisable:** cuando la acción aplica a muchos registros, existe una selección contextual («seleccionar todo (N con cambios)») y forma de limpiarla; la aplicación sigue siendo explícita, por lotes, y reporta lo omitido (p. ej. bajo costo). El paso siguiente conserva el contexto de donde viene la persona (categoría, filtro) sin re-búsquedas.
- **Automatismos seguros:** no confundir sugerencia con confirmación. Para dinero, stock, autorizaciones y asignaciones ambiguas, muestra qué ocurrirá y exige confirmación cuando corresponda. Menos interacciones nunca elimina una autorización necesaria.
- **Dispositivos y accesibilidad:** prueba tarea real en ~390px y ~1280px, con tacto/teclado, feedback claro y sin scroll horizontal; respeta los mínimos del design system.
- **Revisión externa como misión de operadora:** cada item implementado pasa por un UX reviewer independiente, distinto del code reviewer y sin contexto del autor. Recibe un objetivo concreto de negocio y lo ejecuta de principio a fin sin instrucciones del implementador, con volumen representativo; su informe responde el cuestionario mínimo de AGENTS.md y puede BLOQUEAR por esfuerzo manual claramente evitable en tareas frecuentes. Sin interfaz, justifica NO APLICA o su impacto indirecto. No inventar pruebas realizadas ni métricas.

Ejemplo: en compras, conservar el código original del proveedor, reconocer productos ya vinculados, evitar búsquedas duplicadas y corregir varias líneas sin cambiar de pantalla, pero no inferir precios ambiguos. En cobros, presentar importe exacto y acción clara es más importante que eliminar una confirmación protectora.

## Anchura

- `Screen` (design system) es el único dueño del ancho: `p-4 md:p-8`, sin
  `max-w`. Una sola anchura para todas las vistas — no existe el prop `wide`.
- Formularios: la pantalla envuelve SU contenido en `mx-auto max-w-5xl`
  (ver `OrderEditorScreen`). `Sheet`/`Dialog` ya se auto-limitan.
- **Prohibido** `max-w-3xl` / `max-w-6xl` en `src/features/**` — el gate del
  design system (`npm run test`) falla si regresan.
- La tienda pública (`OliviaStorefront`, `PublicCatalogScreen`) es otra
  superficie (clienta final) con anchos propios intencionales: fuera de esta
  regla y fuera del gate de anchura.

## Ritmo vertical (la gramática de Pedidos)

| Situación | Regla |
|---|---|
| Título de pantalla | `ScreenHeader` — ya trae `mb-5` + `rule` |
| Bloque → bloque | `mb-5` (filtros, buscador, KPIs, secciones) |
| Dentro de un grid de tarjetas | `gap-4` |
| Título de sección (h2 serif) | `mb-2` + `rule mb-5` debajo |
| Sin márgenes ad-hoc | si necesitas otra cifra, probablemente el bloque sobra o falta |

## Columnas responsive estándar

| Tipo de vista | Clases |
|---|---|
| Lista de tarjetas (pedidos, clientes, inicio) | `grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3`* |
| Grid de productos | `grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4` |
| Chips/filtros KPI | `grid grid-cols-2 gap-3 sm:grid-cols-5 mb-5` |
| Formulario | `mx-auto max-w-5xl` |

\* Pedidos e Inicio usan `xl:grid-cols-2 2xl:grid-cols-3` (tarjetas más
ricas); Clientes usa `md:grid-cols-2 2xl:grid-cols-3`. La intención es la
misma: las tarjetas fluyen a ocupar el ancho disponible sin volverse
absurdamente anchas.

## Densidad con propósito

Una tarjeta ancha gana su ancho con contenido que importa — no con vacío:

- Cada fila de pedido/inicio lleva dinero a la vista (`Total`, `Saldo`).
- Los botones de acción (verbo de avance, `Cobrar`) van al borde derecho,
  alineados al mismo eje en toda la vista.
- Un dato que no cambia la decisión de la dueña no va en la tarjeta.
- La acción primaria de cada pantalla vive en el `ScreenHeader` (`+ Nuevo`,
  `+ Agregar`) — nunca un botón gigante full-width perdiendo una fila.

## Identidad y tokens

- Jerarquía: `serif-display` para títulos y cifras de fondo, grotesk para UI.
- Color SIEMPRE por tokens (`text-ink`, `bg-surface`, `text-danger`,
  `terracotta` para énfasis). Un color hardcodeado es un bug.
- Fondos crema + tarjetas `bg-paper`/`bg-surface` con radio y sombra del
  sistema; la separación la lleva el espaciado, no los bordes.
- Mobile-first: tap targets ≥ 40px (`min-h-10`), inputs ≥ 16px (`text-base`),
  sin scroll horizontal (el e2e lo aserta a 390px).

## Aplicación

- Nueva vista ⇒ copia la gramática de su familia más cercana (Pedidos para
  listas, Catálogo para grids de entidad, OrderEditor para formularios).
- `npm run test` corre el gate: elementos crudos (`<button>`/`<select>`/
  `<input>` en features/app), imports fuera del barrel, y anchos legacy
  (`max-w-3xl`/`max-w-6xl`) — todo falla la suite.
