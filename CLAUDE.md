# CLAUDE.md

Guía para trabajar en Store OS. Lee esto antes de empezar.

@LOOPS.md

## Flujo de entrega

Un cambio = una rama desde `main` = un draft PR (la spec, si la hay, viaja dentro del mismo PR). Ver `LOOPS.md`. Autonomía permitida: rama, commits, push de rama, draft PR, CI y Preview. Nunca merge, push a `main`, producción ni datos productivos.

## Qué es Store OS

PWA **local-first**, **mobile-first** y **100% en español (México)** para administrar tiendas pequeñas. Multitienda, dos tipos de tienda (Bajo pedido / Inventario y precios). Ver [`README.md`](README.md) y [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Stack: **React 18 + TypeScript + Vite + Tailwind**, `localStorage` (próximamente Firebase), PWA. Sin dependencias de UI externas — el sistema de diseño es propio.

## Comandos

```bash
npm run dev            # desarrollo (5173) — modo demo local sin backend
npm run build          # tsc --noEmit + vite build
npm run typecheck      # tsc --noEmit
npm run test           # vitest (unit + design-system gate)
npm run test:rules     # pruebas de firestore.rules contra el emulador (G-P01/G-P02/G-P05/G-P06)
npm run e2e            # playwright frontend (smoke + responsive + theme, móvil + escritorio)
npm run e2e:firebase   # pruebas contra el emulador Firebase (requiere `npm run emulators`)
npm run emulators      # Firebase Auth + Firestore emuladores en localhost
npm run preview        # build de producción
```

No declares algo "listo" sin evidencia: antes de abrir el PR, `npm run typecheck && npm run test && npm run build` en verde, y e2e cuando el diff lo amerite.

## Arquitectura (lo esencial)

- **Auth + roles:** `src/app/firebase/`. Email/password + Google; primer usuario → `super_admin`, los demás `member`. `AuthProvider` expone el estado; `useStore().cloud` es true al iniciar sesión. Modo demo local (sin sesión) intacto.
- **Cloud:** Firestore en colecciones raíz (`users`, `stores`, `products`, `customers`, `orders`) + membresía (`memberUids`, `ownerUid`, `pendingInvites`). Reglas en `firestore.rules` (super-admin + miembros por tienda). El adaptador `firestoreData.ts` acota lecturas a las tiendas accesibles.
- **Estado:** `StoreProvider` (`useReducer`) es el **único** escritor de `localStorage` en modo demo; en modo cloud escribe en Firestore. Aislamiento entre tiendas **solo** vía selectores en `src/lib/selectors.ts`.
- **Selector de tienda:** "¿Quién opera hoy?" (`StorePickerScreen`) tras iniciar sesión; "Cambiar tienda" regresa a él. Gestión completa (renombrar / cambiar tipo / WhatsApp / miembros / eliminar) en `StoreSettingsScreen`.
- **Sistema de diseño:** todo en `src/design-system/`, importado desde el barrel `index.ts`. Gate de cumplimiento: falla si `src/features/**` o `src/app/**` usan `<button>`/`<select>`/`<input>` crudos (excepción: `ErrorBoundary`).
- **Temas:** `src/design-system/theme/`. Cada tema define tokens (color, tipografía, radios, sombras, **movimiento**). `ThemeProvider` los inyecta en `<html data-theme>`. Per-usuario, persiste en `localStorage` → perfil Firestore.
- **Routing:** router de historia mínimo (`src/lib/router.ts` + `src/app/router.ts`), sin dependencias. Ruta pública `/catalogo/:slug` (funciona en local demo y en cloud: la proyección `publicStores`/`publicProducts` se escribe al crear/renombrar tienda y al guardar productos, con lectura anónima).
- **Datos:** tipos en `src/types/index.ts`. Coerción numérica siempre vía `parseAmount` (`src/lib/money.ts`) — nunca escribas `NaN` al estado.

## Convenciones (importantes)

- **🔴 CERO COSTOS — restricción dura.** El proyecto está en el plan Blaze **solo** porque Cloud Storage lo exige; **no se usa NADA que genere cobro**. Quédate siempre dentro del free tier. Límites no-cost que nos gobiernan:
  - **Firestore:** 1 GiB almacenado, 50K lecturas/día, 20K escrituras/día, 20K borrados/día, 10 GiB egress/mes.
  - **Storage:** 5 GB almacenados, 100 GB descargados/mes, 5K uploads/mes, 50K downloads/mes — **solo válido en regiones `us-central1`/`us-west1`/`us-east1`** (el bucket ya está en `us-east1`; no lo muevas).
  - **Auth:** email/password y Google son gratis. **Nunca auth telefónica** (cobra por SMS).
  - **Hosting:** 10 GB almacenado, 360 MB egress/día.
  - **Cloud Functions:** 2M invocaciones/mes gratis, pero evita Functions a menos que sea estrictamente necesario (cada una es una superficie de costo/latencia).
  - Prohibido: SQL Connect (trial de pago), App Hosting, cualquier servicio de Google Cloud que no sea Firestore/Storage/Functions- dentro-de-cuota.
  - Al diseñar una feature, estima su consumo (ej. `firestore.get()` en reglas = 2 reads por upload) y confirma que cabe en el free tier antes de implementar. Ante la duda, pregunta.
- **UI en español (México); código, tipos, identificadores y comentarios en inglés.**
- **Lenguaje simple, no empresarial.** Evita CRM, SKU, pipeline, fulfillment, gross margin, etc.
- **Mobile-first.** Tap targets ≥ ~40px, inputs a ≥16px (sin zoom en iOS).
- **Comportamiento sin sorpresas:** las decisiones visuales van por tokens del sistema de diseño, no por clases hardcodeadas. Si un color no se adapta al tema, lo estás haciendo mal — usa tokens (`bg-surface`, `text-on-surface`, `text-danger`, etc.).
- **YAGNI / ponytail:** la solución más simple que funcione. Marca atajos deliberados con un comentario `ponytail:`. No agregues abstracciones no solicitadas.
- **Comprobación mínima:** toda lógica no trivial deja un test pequeño atrás (las trivialidades no necesitan test).
- **Garantías de seguridad G-P01–G-P08 (Espec 1):** aislamiento entre tiendas, `super_admin` sin PII de clientas por rol (plano de control `adminStores` separado del plano de datos), proyecciones públicas con allow-list, sin telemetría en el cliente. Ver `docs/superpowers/specs/2026-08-06-security-compliance-harness-design.md`. Las compuertas estáticas corren en `npm run test`; las de reglas en `npm run test:rules`; el egress runtime en `npm run e2e`. Ninguna es renunciable.

## Git / commits (preferencia del usuario)

- **Commits atómicos y regulares**, no un commit gigante. Un commit = un cambio lógico.
- Trabaja en una **branch** (no directamente en `main`) y abre PR.
- Mensajes tipo Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- Haz commit/push solo cuando se te pida (o al cerrar un paso lógico).
- Termina los mensajes de commit con `Co-Authored-By: Codex <noreply@anthropic.com>`. (Esta convención se mantiene idéntica en `AGENTS.md` y `CLAUDE.md` — ambos archivos deben estar a la par.)

## Out of scope (todavía)

Sin pagos/checkout/carrito, sin facturas, sin códigos de barras (la Clave/SKU de producto ya existe; proveedores y compras ya están implementados), sin ledger de inventario, sin analítica. El catálogo público cloud **ya está implementado** (`publicStores`/`publicProducts` en `firestore.rules`, lectura anónima; la proyección se mantiene al crear/editar tienda y productos, y con el botón "Republicar catálogo"). La subida de imágenes funciona pero requiere el grant IAM `roles/datastore.user` al Storage service agent (ver `docs/DEPLOYMENT.md` §4b) o las fotos fallan con 403.

## Estado del roadmap

1. ✅ Firebase Auth + Firestore + modelo de roles (super-admin + miembros por tienda).
2. ✅ Selector de tienda "¿Quién opera hoy?" + gestión completa de tiendas (crear/editar/cambiar tipo/invitar miembros/eliminar).
3. ✅ UI por rol (dueño vs. super-admin) + aislamiento de datos + listo para Vercel.

## Despliegue

Guía completa en `docs/DEPLOYMENT.md` (Firebase + Vercel + variables de entorno + reglas). El primer usuario registrado se vuelve super-admin.

### Ambientes y backends (cableado)

Tres ambientes, dos backends Firebase. **Local y Preview comparten backend**; **Producción** está aislado:

| Ambiente | Backend Firebase | Cómo se cablea |
|---|---|---|
| Local (desarrollo) | `store-os-dev` | `.env` local con las vars de dev (`VITE_FIREBASE_*`). Aquí validan los agentes ANTES de pushear. |
| Preview (Vercel, UAT/QA) | `store-os-dev` | GitHub environment `Preview` → 6 `VITE_FIREBASE_*` secrets de dev. |
| Producción (Vercel) | `store-os-f7cf8` | GitHub environment `Production` → 6 secrets de prod. Aislado: ventas reales. |

`scripts/check-env.cjs` hace cumplir el contrato en CI: un deploy de **Preview** que apunte a prod (o sin projectId) **falla el build**; un deploy de **Production** que no apunte a prod **falla el build**. Los datos de prueba viven en `store-os-dev` y se siembran con `node scripts/seed-dev.cjs` (Olivia + admin@store.os); **nunca** se siembra ni toca prod.

Los diseños detallados viven en `docs/superpowers/specs/`.
