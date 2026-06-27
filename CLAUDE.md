# CLAUDE.md

Guía para trabajar en Store OS. Lee esto antes de empezar.

## Qué es Store OS

PWA **local-first**, **mobile-first** y **100% en español (México)** para administrar tiendas pequeñas. Multitienda, dos tipos de tienda (Bajo pedido / Inventario y precios). Ver [`README.md`](README.md) y [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Stack: **React 18 + TypeScript + Vite + Tailwind**, `localStorage` (próximamente Firebase), PWA. Sin dependencias de UI externas — el sistema de diseño es propio.

## Comandos

```bash
npm run dev        # desarrollo (5173)
npm run build      # tsc --noEmit + vite build
npm run typecheck  # tsc --noEmit
npm run test       # vitest (unit + design-system gate)
npm run e2e        # playwright (móvil + escritorio)
npm run preview    # build de producción
```

Antes de declarar algo "listo": `npm run typecheck && npm run test && npm run build` deben pasar (idealmente `npm run e2e` también).

## Arquitectura (lo esencial)

- **Estado:** un solo `StoreProvider` (`src/app/StoreProvider.tsx`, `useReducer`) es el **único** que escribe `localStorage`. Ningún componente toca `localStorage` directamente. El aislamiento entre tiendas se hace **solo** vía selectores en `src/lib/selectors.ts`.
- **Sistema de diseño:** todo en `src/design-system/`, importado desde el barrel `index.ts`. Las primitivas leen tokens (CSS vars) + Tailwind.
- **Gate de cumplimiento:** `src/design-system/design-system-gate.test.ts` **falla** si `src/features/**` o `src/app/**` renderizan `<button>`/`<select>`/`<input>` crudos o importan UI de fuera del sistema de diseño. No lo eludas — si necesitas un control nuevo, agrégalo al sistema de diseño.
- **Temas:** `src/design-system/theme/`. Cada tema define tokens (color, tipografía, radios, sombras, **movimiento**). `ThemeProvider` los inyecta en `<html data-theme>`. Paper Ledger reproduce el look original como default.
- **Routing:** router de historia mínimo (`src/lib/router.ts` + `src/app/router.ts`), sin dependencias. Ruta pública `/catalogo/:slug`.
- **Datos:** tipos en `src/types/index.ts`. Coerción numérica siempre vía `parseAmount` (`src/lib/money.ts`) — nunca escribas `NaN` al estado.

## Convenciones (importantes)

- **UI en español (México); código, tipos, identificadores y comentarios en inglés.**
- **Lenguaje simple, no empresarial.** Evita CRM, SKU, pipeline, fulfillment, gross margin, etc.
- **Mobile-first.** Tap targets ≥ ~40px, inputs a ≥16px (sin zoom en iOS).
- **Comportamiento sin sorpresas:** las decisiones visuales van por tokens del sistema de diseño, no por clases hardcodeadas. Si un color no se adapta al tema, lo estás haciendo mal — usa tokens (`bg-surface`, `text-on-surface`, `text-danger`, etc.).
- **YAGNI / ponytail:** la solución más simple que funcione. Marca atajos deliberados con un comentario `ponytail:`. No agregues abstracciones no solicitadas.
- **Comprobación mínima:** toda lógica no trivial deja un test pequeño atrás (las trivialidades no necesitan test).

## Git / commits (preferencia del usuario)

- **Commits atómicos y regulares**, no un commit gigante. Un commit = un cambio lógico.
- Trabaja en una **branch** (no directamente en `main`) y abre PR.
- Mensajes tipo Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- Haz commit/push solo cuando se te pida (o al cerrar un paso lógico).
- Termina los mensajes de commit con `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Out of scope (todavía)

Sin auth, sin backend/sync, sin subida real de imágenes (solo URL), sin pagos/checkout/carrito, sin facturas, sin proveedores, sin códigos de barras/SKU, sin ledger de inventario, sin analítica. El catálogo público es local (no es compartible globalmente hasta que exista backend).

## Próximos sub-proyectos (en orden)

1. Firebase Auth + Firestore + modelo de roles (super-admin + miembros por tienda). Spec: pendiente.
2. Selector de tienda "¿Quién opera hoy?" + gestión completa de tiendas (crear/editar/cambiar tipo/eliminar).
3. UI por rol (dueño vs. super-admin).

Los diseños detallados viven en `docs/superpowers/specs/`.
