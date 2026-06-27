# Store OS

> Un sistema operativo ligero para pequeñas tiendas.

Store OS es una PWA **local-first**, **mobile-first** y **100% en español (México)** para llevar tiendas pequeñas que venden por WhatsApp, Instagram o catálogo público.

No es un ERP, ni un POS, ni un CRM, ni un sistema de contabilidad. Es un **cuaderno moderno** para administrar tu tienda: catálogo, clientes, pedidos, inventario y ganancia.

Pensado para que cualquiera lo use: un adolescente que vende por primera vez, un negocio de joyería, o alguien no técnico con una tablet Android.

---

## Características

- **Multitienda** — crea y administra varias tiendas; cada una con sus datos aislados.
- **Dos tipos de tienda:**
  - **Bajo pedido** — no guardas inventario (perfumes, tenis, gorras). Un precio por producto.
  - **Inventario y precios** — tienes stock y precios por nivel: **Menudeo, Mayoreo, Emprendedora**.
- **Catálogo** público y privado (con vista pública compartible por enlace).
- **Pedidos** con flujo de estatus de principio a fin: _Preguntó → Confirmado → Comprar → Comprado → Llegó → Entregado → Cobrado_.
- **Clientes** con historial de ventas y saldos pendientes.
- **Inventario** con ajustes rápidos (−1 / +1) y alertas de baja existencia (solo tiendas con inventario).
- **Tres temas** intercambiables: **Paper Ledger**, **Maximalista** y **Lujo** — cada uno con su propia personalidad (color, tipografía, movimiento).
- **Responsive** — funciona en móvil (bottom nav) y escritorio (sidebar).
- **PWA** instalable y con soporte offline.
- **Local-first** — todo se guarda en el navegador (`localStorage`). Sin nube… todavía.

## Empezar

Requisitos: Node 18+ y npm.

```bash
npm install
npm run dev       # servidor de desarrollo (http://localhost:5173)
npm run build     # build de producción (tsc + vite)
npm run preview   # previsualiza el build de producción
```

### Pruebas y calidad

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest (unit + design-system gate)
npm run e2e         # playwright (mobile + desktop)
```

Los datos de ejemplo (dos tiendas: **Santi** y **Joyería**) se cargan automáticamente en el primer uso. Puedes reiniciarlos desde **Opciones → Reiniciar con datos de ejemplo**.

## Estructura del proyecto

```
src/
  app/            # App, AppShell (responsive), StoreProvider (estado), router
  design-system/  # sistema de diseño (tokens, primitivos, gate) + theme/
  features/       # pantallas por dominio: stores, home, catalog, customers, orders, inventory
  lib/            # ids, money, dates, storage, selectors, whatsapp, seed, labels, router
  types/          # modelo de datos (Store, Product, Customer, Order)
docs/
  ARCHITECTURE.md
  superpowers/specs/   # diseños (specs) por sub-proyecto
e2e/              # pruebas end-to-end (Playwright)
public/           # manifest, service worker, icono
```

## Estado del proyecto

- ✅ App base (multitienda, catálogo, pedidos, clientes, inventario)
- ✅ Sistema de diseño unificado con gate de cumplimiento
- ✅ Layout responsive (móvil + escritorio)
- ✅ Sistema de temas (Paper Ledger / Maximalista / Lujo)
- ⏭️ Autenticación + backend (Firebase Auth + Firestore) + roles — en diseño
- ⏭️ Selector de tienda estilo "¿quién opera hoy?" + gestión completa de tiendas
- ⏭️ UI por rol (dueño vs. super-admin)

## Decisiones de diseño

- **UI en español (México)**; código, tipos, identificadores y comentarios en inglés.
- **Sin dependencias de UI externas** — el sistema de diseño es propio y token-driven.
- **Lenguaje simple, no empresarial** — evitamos jerga (CRM, SKU, pipeline, fulfillment).
- Diseño detallado por sub-proyecto en [`docs/superpowers/specs/`](docs/superpowers/specs/).

## Licencia

Privado (por ahora).
