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
