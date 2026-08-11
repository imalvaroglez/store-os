# Changelog

Todos los cambios notables de Store OS se documentan aquí.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [0.5.0] — 2026-08-11 (mergeado a main, deployado a producción)

> PR #12 mergeado (`7645b73`). Production deploy vía CI (gate verde). Reglas
> de Firestore deployadas a los 3 ambientes (dev, prod) para eliminar el drift
> estructural. Olivia visible y operable en `store-os-alpha.vercel.app`.

### Added — CI/CD y cableado de ambientes
- **Deploy desde GitHub Actions:** el deploy a Vercel lo dispara Actions
  **solo si** `build-test` + `rules-and-e2e` pasan. Vercel auto-deploy OFF
  (Ignored Build Step `exit 0`). Captura correcta de la URL de preview y
  comment automático en el PR.
- **Cableado de 3 ambientes:** **Local + Preview** = `store-os-dev` (mismo
  backend); **Producción** = `store-os-f7cf8` (aislado). GitHub es la fuente
  única de `VITE_FIREBASE_*` (las vars de Vercel se eliminaron para evitar drift).
- **Policy estricta de sincronización** (`docs/LOOPS.md` §4): datos aislados
  dev↔preview; estructura (reglas, schema, IAM) fluye a los 3 ambientes;
  promoción local→preview→prod solo con aprobación humana.

### Added — Flujo de compra rediseñado
- **Crear proveedor al vuelo** (F1) desde el formulario de compra (`+ Nuevo
  proveedor`), auto-seleccionado al guardar.
- **Crear producto al vuelo** (F2) desde una línea de compra (`+ Nuevo
  producto`); nace privado por defecto, con toggle para publicar.
- **Editar precio de venta** (F3) desde la línea de compra (Menudeo/Mayoreo/
  Emprendedora para inventory_tiered; Precio de venta para on_demand).
- **Eliminar clientes** (B2) desde la UI (menú ⋯ por tarjeta + diálogo de
  confirmación con conteo de pedidos asociados).
- **Botón "Ver público"** en el catálogo admin: abre el storefront público en
  pestaña nueva.

### Changed
- **Acceso del super_admin a entidades** arreglado: los listeners ahora filtran
  con `where(storeId in [...])` (antes bare collection → `permission-denied`
  porque las reglas dependen de `resource.data` y Firestore aplica "rules are
  not filters").
- **Producto nuevo nace privado** por defecto (`status: "draft"`); Fer publica
  explícitamente cuando quiere.
- **Badge de estado** en admin gobernado solo por `status` (consistente con la
  visibilidad pública real; eliminado el ambiguo "Privado").
- **Botones de avance de pedido** en imperativo ("Confirmar", no "Confirmado");
  badge de estado se mantiene en participio.
- **`SuppliersScreen`** recibe `storeId` por prop (no lee `activeStore` global):
  arregla la hoja de Proveedores que se abría vacía desde Ajustes de tienda (B1).
- **`seed-dev.cjs`** escribe `adminStores` (plano de control) + `type`/`slug`;
  Olivia visible para el super_admin.

### Fixed
- **Regresión de persistencia de compras:** `stripUndefined` recursivo en
  `saveEntity` — `undefined` anidado en `lines[]` (de los campos de precio F3)
  llegaba a Firestore y rechazaba el ticket completo ("Unsupported field value").
- **Preview de foto en el modal de producto** no se sale del tile (wrapper
  `absolute inset-0`).
- **Reglas de Firestore deployadas a los 3 ambientes** (dev, prod): el drift
  estructural (reglas del repo vs deployadas) era la causa raíz de "Olivia no
  aparece" en dev y prod. Ahora en sync.

### Removed
- **Modo demo eliminado:** nada visible sin login. La app ya no auto-carga tiendas
  demo (Olivia/Santi/Joyería) en el navegador ni siembra demos en cuentas cloud
  nuevas (`seedCloudIfEmpty` es no-op). Un visitante sin sesión ve solo la
  pantalla de login.

### Docs
- `docs/LOOPS.md` §4 + §8: policy de sincronización de ambientes.
- `docs/BACKLOG.md` reorganizado: índice por prioridad (Compliance = próximo
  ciclo) + features (unificar catálogo/inventario, WYSIWYG, precios escalables,
  recibos) + sección de deuda técnica.
- Spec del rediseño del flujo de compra (`docs/superpowers/specs/`).

### Próximo
- **Compliance / Privacidad (Espec 2):** `/privacidad/:slug` + ARCO V1 (diseño
  aprobado, sin implementar). Olivia necesita aviso de privacidad antes de ventas
  reales.

## [0.4.0] — 2026-06-27

### Added
- **Firebase foundation:** Auth (email/password + Google), Firestore (colecciones raíz
  + membresía), reglas de seguridad (super-admin + miembros por tienda), primer
  usuario → super_admin. Modo demo local (sin sesión) intacto; modo cloud al iniciar sesión.
- **Selector de tienda "¿Quién opera hoy?"** (lista compacta) tras iniciar sesión;
  "Cambiar tienda" regresa a él.
- **Gestión completa de tiendas:** renombrar, cambiar tipo (Bajo pedido ↔ Inventario
  y precios), WhatsApp, invitar miembros por correo (con link de acceso si no tienen
  cuenta), quitar miembros, eliminar tienda (cascada).
- **UI por rol + aislamiento de datos:** dueños ven solo sus tiendas; super-admin ve
  todo. Lecturas acotadas por membresía en cliente y reglas.
- **ErrorBoundary** para recuperación ante fallos en producción.
- **Listo para Vercel:** `vercel.json` (SPA rewrite, cache de assets) + guía de
  despliegue (`docs/DEPLOYMENT.md`).
- Pruebas e2e contra el emulador Firebase (signup → admin + seed; sign out → demo;
  member sin tiendas; picker + crear tienda).

### Changed
- `npm run e2e` ahora excluye las pruebas de Firebase (requieren emulador); usa
  `npm run e2e:firebase`. Nuevos scripts `emulators` y `e2e:firebase`.
- `StoreProvider` es auth-aware: localStorage (demo) o Firestore (cloud); escrituras
  optimistas + sincronización por `onSnapshot`.

## [0.3.0] — 2026-06-27

### Added
- Sistema de temas intercambiables: **Paper Ledger** (por defecto), **Maximalista** y **Lujo**.
  Cada tema es una personalidad completa: color, tipografía, radios, sombras y movimiento.
- `ThemeProvider` que inyecte tokens de CSS, fuentes y keyframes en `<html data-theme>`.
- Selector de tema en Opciones con vista previa en vivo; persiste en `localStorage`.
- Soporte para `prefers-reduced-motion` (amortigua animaciones).
- Pruebas unitarias de temas + pruebas E2E de cambio de tema (móvil y escritorio).

### Fixed
- Contraste de los temas oscuro/maximalista: las superficies y colores de estatus ahora
  pasan por tokens de tema (`--surface`, `--on-surface`, `--danger`, `--success`).
- El ítem activo del sidebar ahora usa una píldora de acento consciente del tema
  (era texto color tinta sobre fondo claro → ilegible en Lujo).

## [0.2.0] — 2026-06-26

### Added
- Layout **responsive** de móvil a escritorio: bottom-nav en móvil, sidebar fija en escritorio (`md`).
- `Sidebar` y `Screen` como primitivas del sistema de diseño; `navItems` como fuente única de navegación.
- Cuadrículas multi-columna responsivas en catálogo, pedidos, clientes e inventario.
- Catálogo público con hero responsivo y cuadrícula de productos.
- Proyectos de Playwright para móvil (390×844) y escritorio (1280×800) + spec responsivo.

### Changed
- `Sheet` ahora es responsive: bottom-sheet en móvil, modal centrado en escritorio.

## [0.1.0] — 2026-06-26

### Added
- App base **Store OS**: multitienda local-first, PWA, 100% en español (México).
- Dos tipos de tienda: **Bajo pedido** y **Inventario y precios** (Menudeo/Mayoreo/Emprendedora).
- Catálogo (admin + público en `/catalogo/:slug`), clientes, pedidos (flujo de 7 estatus),
  inventario con ajustes −1/+1, y pantalla de Inicio con "¿Qué necesito hacer hoy?".
- `StoreProvider` (`useReducer`) como único escritor de `localStorage`; aislamiento por tienda
  vía selectores.
- Sistema de diseño unificado (`src/design-system/`) con **gate de cumplimiento**: falla si una
  pantalla usa `<button>`/`<select>`/`<input>` crudo o importa UI fuera del sistema.
- Router de historia mínimo (sin dependencias).
- Datos de ejemplo: tiendas **Santi** (bajo pedido) y **Joyería** (inventario).
- Pruebas: vitest (money, selectores, aislamiento, render) + Playwright (smoke end-to-end).
- Manifiesto PWA + service worker (instalable, offline).
