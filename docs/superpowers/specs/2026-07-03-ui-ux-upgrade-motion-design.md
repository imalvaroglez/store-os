# UI/UX upgrade — motion & polish components

**Fecha:** 2026-07-03
**Branch:** `feat/product-image-upload` (continúa aquí; todo en la misma feature)
**Enfoque:** Componentes nuevos desde 21st.dev (idea + reconstrucción con tokens, cero dependencias).

## Objetivo

Elevar el atractivo visual y la sensación de modernidad de Store OS mediante un
conjunto de componentes de movimiento y estructura que, hoy, no existen en el
design-system. El norte es comercial: **lo visual entra primero**, después la
funcionalidad. La app debe sentirse como un producto premium, no como un admin
barato.

## Referencias estéticas

- **Apple (scroll/layering):** movimiento fluido, capas, sensación premium. *No*
  la réplica literal de scroll-cinematográfico — YAGNI para un admin de tiendas.
  Tomamos el principio: el movimiento transmite calidad.
- **Pitchfork:** editorial, jerarquía tipográfica fuerte, fotos como
  protagonistas, secciones escasas y claras, contraste sobrio. Traducción:
  más jerarquía, fotos grandes de producto, más aire, menos tarjetas amontonadas.

## Restricciones (rigen todo)

- **🔴 Cero costos / free tier.** Ningún componente añade consumo de Firestore
  / Storage / Functions. Son puramente de presentación.
- **Sistema de diseño propio, sin dependencias de UI externas.** Ningún `npx
  shadcn add`. Todo se reconstruye dentro de `src/design-system/`.
- **Tokens del tema obligatorios.** Cada componente lee `--motion-*`,
  `--radius-*`, colores vía tokens (`bg-surface`, `text-on-surface`,
  `text-danger`, etc.). Hereda los 3 temas (Paper Ledger / Maximalista / Lujo) y
  respeta `prefers-reduced-motion` (ya anulado por `ThemeProvider`).
- **Mobile-first.** Tap targets ≥ ~40px, inputs ≥ 16px.
- **UI en español (México); código/tipos/identificadores/comentarios en inglés.**

## Decisión técnica: animación sin dependencias

**Enfoque A — CSS puro + IntersectionObserver nativo, cero dependencias.**

- Skeletons, toast, reveal, lightbox, modal, dropdown: `@keyframes` + transiciones
  CSS + `IntersectionObserver`.
- AnimatedNumber: ~20 líneas con `requestAnimationFrame`.
- Command palette y accesibilidad de modal/dropdown (focus-trap, ARIA): se
  construyen a mano. Más código, cero peso, control total de tokens.

Descartado: framer-motion (~40KB gz, overkill para el 80% de los efectos,
rompe la regla de "sin deps de UI") y el híbrido con deps puntuales (decisión
del usuario: A puro).

## Arquitectura

Todo se integra al **design-system existente** (`src/design-system/`), no a una
feature nueva. Ningún archivo de `src/features/**` se modifica salvo para
**consumir** los componentes (reemplazar Spinner por Skeleton, disparar toasts,
etc.). El `design-system-gate.test.ts` sigue vigente.

Principio rector: todos los componentes leen tokens del tema, heredan los 3
temas y respetan `prefers-reduced-motion`.

## Componentes (8)

### Fase 1 — Fundación

#### 1. Toasts — `Toast.tsx` + `ToastProvider.tsx`

- `ToastProvider` en la raíz del árbol (junto a `StoreProvider`/`AuthProvider`).
- Hook `useToast()`: `success(msg)`, `error(msg, { action })`, `info(msg)`.
- Posición: inferior (mobile) / inferior-derecha (desktop), apilados, máx 3.
- Auto-cierre 3.5s con barra de progreso del countdown.
- Variantes success/error/info con tonos `--success`/`--danger`/`--accent`.
- Acción opcional inline ("Deshacer", "Reintentar").
- Animación entrada/salida `@keyframes` + `--motion-base`.
- Accesible: `role="status"`/`role="alert"`, `aria-live`.
- **Dónde se enchufa:** avanzar pedido, guardar producto/cliente/tienda, invitar
  miembro, eliminar (con "Deshacer"). Hoy todas son silenciosas.
- `ponytail:` sin cola sofisticada ni promesas. `toast.promise()` se añade si llega.

#### 2. Skeletons — `Skeleton.tsx`

- Exporta `Skeleton`, `SkeletonCard` (imagen + 2 líneas), `SkeletonText`.
- Shimmer con gradiente desplazándose (`@keyframes` sobre `background-position`).
- Color derivado de `--surface` (~10% más oscuro); funciona en 3 temas.
- `prefers-reduced-motion`: gris estático sin parpadeo.
- `aria-busy` + `role="status"`.
- **Dónde:** `CatalogScreen`, `OrdersScreen`, `CustomersScreen` (cloud). `Spinner`
  se conserva para acciones puntuales (botones, guardando).
- `ponytail:` `SkeletonCard` asume forma genérica. Formas raras se arman con
  `<Skeleton>` suelto. Una sola variante de tarjeta.

### Fase 2 — Estética editorial

#### 3. AnimatedNumber — `AnimatedNumber.tsx`

- `<AnimatedNumber value={n} format="currency" />` (currency → MXN vía helper de
  money; sin formato → entero `es-MX`).
- Dispara con `IntersectionObserver` al entrar al viewport.
- Easing cubic-out, ~1.2s, atado a `--motion-base`/`--motion-slow`.
- Tipografía serif tabular consistente con `Money`/`StatRow`.
- `prefers-reduced-motion`: valor final sin animar.
- **Dónde:** stats de `HomeScreen`, `StatRow` de clientes.
- `ponytail:` un easing, una duración. Re-contar en vivo es YAGNI hoy.

#### 4. Reveal — `Reveal.tsx`

- Hook `useInView(ref)` (IntersectionObserver, threshold ~0.15) + `<Reveal>`.
- Fade-up: `opacity 0→1` + `translateY(16px)→0`, atado a `--motion-base`.
- `<RevealList>`: stagger incremental ~80ms, tope 6 items.
- Auto-limpieza: tras animar, desconecta el observer (no re-anima al subir).
- No anida: un `Reveal` dentro de otro no duplica animación.
- Respeta `prefers-reduced-motion`.
- **Dónde:** grids de Catálogo, Pedidos, Clientes; pedidos activos de Inicio.
  **No** en Inventario (ruido sobre el stepper).
- `ponytail:` una sola dirección (fade-up). Sin variantes from-left/scale-in.

### Fase 3 — Showcase

#### 5. Lightbox — `Lightbox.tsx`

- Overlay a pantalla completa para foto de producto en grande.
- Entrada `scale(.92)→1` + fade; backdrop oscuro sobre `--ink`.
- Navegación: flechas ←/→, swipe horizontal (móvil), teclado (desktop), Esc.
- Caption opcional (nombre/precio) en serif al pie — vibe Pitchfork.
- Reutiliza `ProductImage` (no duplica la lógica EXIF/contentType ya arreglada).
- Bloquea scroll del body. `role="dialog"`, `aria-label`, foco al botón cerrar.
- **Dónde:** ÚNICAMENTE `PublicCatalogScreen` (`/catalogo/:slug`). No en catálogo admin.
- `ponytail:` una foto a la vez con galería navegable. Sin zoom/pinch, sin miniaturas.
- **Nota cero-costos:** funciona en demo local; en cloud se habilita junto con el
  path público de Firestore (pendiente, fuera de este spec).

### Fase 4 — Diálogo y acciones

#### 6. Dialog/Modal — `Dialog.tsx`

- `<Dialog open title tone="danger">` + `<DialogFooter>`.
- Centrado, backdrop con blur, entrada `scale(.96)→1` + fade (`--motion-base`).
- **Focus-trap manual** (Tab/Shift+Tab dentro), foco inicial al primer actionable,
  restore del foco al cerrar. Esc cierra. Bloquea scroll del body.
- `role="dialog" aria-modal="true"`.
- `tone="danger"` pinta con `--danger`; reusa variantes de `Button`.
- **Dónde:** confirma "Eliminar tienda" (saca la acción destructiva del formulario
  denso de `StoreSettingsScreen`), avanzar pedido a estados terminales,
  "¿Eliminar producto?".
- **Relación con `Sheet`:** Sheet = crear/editar (formularios, mobile-first).
  Dialog = confirmar/pedir decisión rápida. Roles complementarios, sin solape.
- `ponytail:` focus-trap a mano con `onKeyDown` + focuseables. Si llegan shadow-DOM
  / iframes, se reconsidera una dep — anotado, no ahora.

#### 7. Dropdown/Context menu — `Dropdown.tsx`

- `<Dropdown trigger={...}>` con `<DropdownItem>`, `<DropdownSeparator>`.
- Posicionamiento automático arriba/abajo según espacio (`getBoundingClientRect`).
- Abre con tap/click; flechas ↑/↓ navegan, Enter ejecuta, Esc/click-fuera cierra.
- `role="menu"`, items `role="menuitem"`, `aria-expanded`.
- Entrada `fade + translateY(-4px)→0`, `--motion-fast` (rápido).
- `tone="danger"` para acción destructiva.
- **Dónde:** cada tarjeta de Catálogo, Pedidos, Clientes gana menú "⋯" (editar,
  duplicar, eliminar). Limpia el ruido de botones sueltos.
- `ponytail:` flip simple arriba/abajo. Sin submenús anidados, sin virtualización.

#### 8. Command palette — `CommandPalette.tsx`

- Cmd/Ctrl+K global (desktop) + botón "Buscar" visible en desktop. Secundario en móvil.
- Input + lista agrupada, fuzzy-match casero (substring + scoring, ~15 líneas, sin `cmdk`).
- Flechas ↑/↓ navegan, Enter ejecuta, Esc cierra.
- Resaltado del match, estado vacío.
- Entrada: backdrop blur + panel `scale(.98)→1` + fade (`--motion-base`).
- Reusa focus-trap y ARIA del Dialog.
- **Fuentes:** navegación (5 tabs + Ajustes), acciones rápidas ("Nuevo pedido",
  "Agregar producto", "Cambiar tienda"), búsqueda de producto por nombre.
- **Dónde:** `AppShell` lo monta a nivel raíz; fuentes desde selectores/state existentes.
- `ponytail:` fuzzy casero. Sin histórico/recientes/multi-fuente async. Nav rápida, no launcher.
- **Desktop-first:** herramienta de escritorio por naturaleza. En móvil no estorba
  (botón opcional) pero no se cuenta como mejora móvil.

## Postergado (Tier 5 — YAGNI)

Motion footer Apple/GSAP, carousels 3D, magic text reveal. Anotado para una
landing/marketing futura, no para el producto.

## Estrategia de implementación

- **Todo en la branch actual** (`feat/product-image-upload`), una feature continua.
- **Uno a uno, commits atómicos** por componente. Cada componente: implementar →
  verificar → commitear → siguiente.
- **Orden de fases:** 1 → 2 → 3 → 4.
- Cada commit Conventional Commits (`feat(design-system): add toast component`, etc.),
  cierra con `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Verificación por componente (antes de declarar listo)

- `npm run typecheck && npm run test && npm run build` pasan.
- `design-system-gate.test.ts` no se rompe (sin `<button>`/`<select>`/`<input>`
  crudos en features/app).
- Un test pequeño del componente (lógica no trivial: counter dispara en viewport,
  focus-trap retiene, fuzzy-match acierta). Trivialidades sin test (YAGNI aplica).
- Visual: se ve correcto en los 3 temas y respeta `prefers-reduced-motion`.
