# CLAUDE.md

Guía para trabajar en Store OS. Lee esto antes de empezar.

## Qué es Store OS

PWA **local-first**, **mobile-first** y **100% en español (México)** para administrar tiendas pequeñas. Multitienda, dos tipos de tienda (Bajo pedido / Inventario y precios). Ver [`README.md`](README.md) y [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Stack: **React 18 + TypeScript + Vite + Tailwind**, `localStorage` (próximamente Firebase), PWA. Sin dependencias de UI externas — el sistema de diseño es propio.

## Comandos

```bash
npm run dev            # desarrollo (5173) — modo demo local sin backend
npm run build          # tsc --noEmit + vite build
npm run typecheck      # tsc --noEmit
npm run test           # vitest (unit + design-system gate)
npm run e2e            # playwright frontend (smoke + responsive + theme, móvil + escritorio)
npm run e2e:firebase   # pruebas contra el emulador Firebase (requiere `npm run emulators`)
npm run emulators      # Firebase Auth + Firestore emuladores en localhost
npm run preview        # build de producción
```

Antes de declarar algo "listo": `npm run typecheck && npm run test && npm run build` deben pasar (idealmente `npm run e2e` también). Cambios en auth/cloud: `npm run e2e:firebase`.

## Arquitectura (lo esencial)

- **Auth + roles:** `src/app/firebase/`. Email/password + Google; primer usuario → `super_admin`, los demás `member`. `AuthProvider` expone el estado; `useStore().cloud` es true al iniciar sesión. Modo demo local (sin sesión) intacto.
- **Cloud:** Firestore en colecciones raíz (`users`, `stores`, `products`, `customers`, `orders`) + membresía (`memberUids`, `ownerUid`, `pendingInvites`). Reglas en `firestore.rules` (super-admin + miembros por tienda). El adaptador `firestoreData.ts` acota lecturas a las tiendas accesibles.
- **Estado:** `StoreProvider` (`useReducer`) es el **único** escritor de `localStorage` en modo demo; en modo cloud escribe en Firestore. Aislamiento entre tiendas **solo** vía selectores en `src/lib/selectors.ts`.
- **Selector de tienda:** "¿Quién opera hoy?" (`StorePickerScreen`) tras iniciar sesión; "Cambiar tienda" regresa a él. Gestión completa (renombrar / cambiar tipo / WhatsApp / miembros / eliminar) en `StoreSettingsScreen`.
- **Sistema de diseño:** todo en `src/design-system/`, importado desde el barrel `index.ts`. Gate de cumplimiento: falla si `src/features/**` o `src/app/**` usan `<button>`/`<select>`/`<input>` crudos (excepción: `ErrorBoundary`).
- **Temas:** `src/design-system/theme/`. Cada tema define tokens (color, tipografía, radios, sombras, **movimiento**). `ThemeProvider` los inyecta en `<html data-theme>`. Per-usuario, persiste en `localStorage` → perfil Firestore.
- **Routing:** router de historia mínimo (`src/lib/router.ts` + `src/app/router.ts`), sin dependencias. Ruta pública `/catalogo/:slug` (local demo; cloud requiere path público, pendiente).
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

Sin subida real de imágenes (solo URL), sin pagos/checkout/carrito, sin facturas, sin proveedores, sin códigos de barras/SKU, sin ledger de inventario, sin analítica. El catálogo público para tiendas en la nube requiere un path público en Firestore (pendiente); el catálogo local-demo funciona.

## Estado del roadmap

1. ✅ Firebase Auth + Firestore + modelo de roles (super-admin + miembros por tienda).
2. ✅ Selector de tienda "¿Quién opera hoy?" + gestión completa de tiendas (crear/editar/cambiar tipo/invitar miembros/eliminar).
3. ✅ UI por rol (dueño vs. super-admin) + aislamiento de datos + listo para Vercel.

## Despliegue

Guía completa en `docs/DEPLOYMENT.md` (Firebase + Vercel + variables de entorno + reglas). El primer usuario registrado se vuelve super-admin.

Los diseños detallados viven en `docs/superpowers/specs/`.
