# Changelog

Todos los cambios notables de Store OS se documentan aquí.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Unreleased]

### Added
- **Catálogo público en la nube:** proyecciones de solo lectura pública
  (`publicStores/{slug}`, `publicProducts/{id}`, reserva global de slugs en
  `slugs/{slug}`). Carga anónima (sin sesión) en `/catalogo/:slug` directo desde
  Firestore; solo campos públicos (nunca costo, ganancia, notas, clientes, pedidos,
  inventario). Acción "Republicar catálogo" en los ajustes de la tienda y
  desproyección del slug viejo al renombrar.
- **Modo emulador blindado:** nunca se activa en builds de producción, aunque la
  bandera `VITE_FIREBASE_EMULATOR` se filtre al entorno de build.

### Próximo
- _—_

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
- `Sidebar` y `Screen` como primitivos del sistema de diseño; `navItems` como fuente única de navegación.
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
