# Store OS

Un sistema operativo ligero para pequeñas tiendas. PWA local-first, móvil y 100% en español (México).

No es un ERP, ni un POS, ni un CRM. Es un cuaderno moderno para llevar tu tienda: catálogo, clientes, pedidos, inventario y ganancia.

## Empezar

```bash
npm install
npm run dev      # desarrollo
npm run build    # build de producción (tsc + vite)
npm run test     # vitest
npm run typecheck
```

## Dos tipos de tienda

- **Bajo pedido** — no guardas inventario (perfumes, tenis, gorras). Un precio por producto.
- **Inventario y precios** — tienes stock y precios por nivel: Menudeo, Mayoreo, Emprendedora.

Los datos de cada tienda están aislados. Todo se guarda en `localStorage`; no hay nube (todavía).

## Catálogo público

Cada tienda tiene un catálogo local en `/catalogo/:slug` que muestra solo productos públicos (sin costo, ganancia, notas privadas ni inventario) con un botón de **Pedir por WhatsApp**. Es local: no es compartible globalmente hasta que se agregue un backend.

## Decisiones técnicas

- React + TypeScript + Vite + Tailwind.
- Estado: un solo `StoreProvider` (`useReducer`); ningún componente toca `localStorage` directamente.
- Routing: un router de historia mínimo, sin dependencias.
- PWA: instalable y offline (manifest + service worker).
- Tests: Vitest sobre `lib/` (money, precios, aislamiento, filtrado del catálogo) + pruebas de render.

Capa de datos diseñada para que Firebase entre después sin reescribir la UI: solo se cambia el adaptador de almacenamiento.

Diseño: `docs/superpowers/specs/2026-06-26-store-os-mvp-design.md`.
