# Changelog

Todos los cambios notables de Store OS se documentan aquí.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Unreleased]

### Próximo
- Autenticación + backend (Firebase Auth + Firestore) y modelo de roles.
- Selector de tienda "¿Quién opera hoy?" + gestión de tiendas (crear / editar / cambiar tipo / eliminar).
- UI por rol (dueño de tienda vs. super-admin).

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
