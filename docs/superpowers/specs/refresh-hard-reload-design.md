---
Delivery-ID: refresh-hard-reload
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/refresh-hard-reload-design.md
---
# Refresh y hard reload confiables ("un refresh debería funcionar como un refresh")

## Problema

Reporte del PO (release blocker, `docs/BACKLOG.md:25-28`): tras promover
deploys, los datos/la UI se quedan estancados hasta cerrar todas las pestañas
o al día siguiente. Un refresh del navegador debe cargar SIEMPRE estado fresco
— tras un deploy, tras un cambio de membresía, tras un cambio de sesión.

Antecedente de proceso: un lanzamiento previo reportó COMPLETE con un
objective hardcoded y evidencia reusada del seed-dev; el refresh real nunca
corrió. Esta entrega cierra con un criterio ejecutable, no con un checklist.

## Estado verificado de las hipótesis (causa raíz)

Las hipótesis 1 y 4 del backlog YA están mitigadas por el PR #23
(81c8ed6, 2026-08-13) — verificado en código:

1. **SW/PWA cache (mitigado, falta prueba):** `public/sw.js` es network-first
   para navegación con `cache.put("/index.html")` de rotación en cada navegación
   online + fallback offline; `skipWaiting`/`clients.claim` en install/activate.
2. **`sw.js` stalado (mitigado):** `vercel.json` manda `Cache-Control: no-cache`
   para `/sw.js` e `/index.html`; assets con `immutable, max-age=1y` (nombres
   con hash). `src/pwa.ts` registra con `updateViaCache: "none"`.
3. **Build marker (existe):** `src/app/App.tsx:94` renderiza
   `data-build-marker={sha}` (virtual module `store-os-build-marker`,
   `vite.config.ts:19`).
4. **Suscripción cloud (verificado, sin bug conocido pendiente):**
   `subscribeCloudState` escucha `stores`/`adminStores` y las 4 colecciones de
   entidades con `where("storeId","in",[...])` (`firestoreData.ts:79-110`);
   una membresía nueva mid-session dispara el reload completo. Permanece como
   hipótesis a reproducir en e2e, no como fix conocido.
5. **Auth persistence (abierto):** `browserLocalPersistence` rehidrata sesión;
   al montar `AuthProvider` con sesión previa se corre el mismo flujo
   load+subscribe (`StoreProvider.tsx:181-212`). Sin evidencia de fallo; se
   cubre con la misma prueba e2e.

**Lo que falta no es más mitigación a ciegas: es la prueba ejecutable del
criterio de cierre y el cierre de los residuos que esa prueba exponga.**

## Objetivo / Criterio de cierre

Un e2e que simule el ciclo real —"deploy" (build con SHA distinto) →
navegador con la versión anterior cargada (y SW activo) → reload normal y
hard reload— y afirme que el estado fresco aparece sin trucos, usando el
`data-build-marker` como testigo de versión y datos sembrados como testigo de
estado.

## Alcance (in)

1. **E2E de refresh (Playwright, sobre `vite preview` con build real):**
   - Build A (SHA conocido) → cargar app, dejar SW instalado.
   - Build B (SHA distinto, mismo puerto/URL) → **reload normal** → afirmar
     `data-build-marker` == SHA B y datos frescos.
   - Repetir con **hard reload** (cache bypass) y con una pestaña que quedó
     abierta durante el "deploy" (sin cerrar): al recargar, versión B.
   - Modo cloud (emulador): usuario con sesión; siembro un dato nuevo "entre
     deploys"; reload → el dato aparece (cubre hipótesis 4/5: suscripción y
     auth persistence al montar con sesión previa).
2. **Cierre de residuos que la prueba exponga** (sólo si el e2e falla):
   bumps de `CACHE` ligados al build marker, headers adicionales, o re-suscripción
   al cambiar sesión/tienda — el mínimo diff que haga pasar el criterio. Sin
   rediseño del SW ni Workbox (ponytail: el shell es pequeño).
3. **Guard de regresión:** el e2e de refresh entra a la suite de CI
   (`npm run e2e` o un perfil `e2e:preview`) para que ningún cambio de
   sw/headers lo rompa en silencio.
4. **Limpieza post-cierre** (ya decidida en backlog): retirar
   `dist-a|dist-b` del `.gitignore` cuando este item cierre, si el e2e los
   usó como artefacto de rotación.

## Alcance (out)

- Workbox/precache de rutas, estrategias por asset, offline-first de datos
  (los datos ya son live en cloud; en demo, `localStorage`).
- Reescribir `subscribeCloudState` (sólo toca si el e2e lo incrimina).
- Telemetría de versiones.

## Costo (free tier)

Cero runtime: builds y Playwright corren en CI/local. El e2e cloud usa el
emulador Firebase (cero cuota). Sin cambios de Firestore/Storage.

## Pruebas

- E2E descrito en Alcance 1 (el entregable central).
- Unit sólo si hay fix (p. ej. versión de CACHE derivada del marker): test
  mínimo del helper introducido.

## previewChecks

```json
[
  { "path": "/", "selector": "body", "text": "Entrar" }
]
```

(Humo de arranque; el criterio real de cierre es el e2e de refresh.)

## Riesgos

- El e2e de "dos builds" es el trozo nuevo: se resuelve con dos directorios
  de build y un servidor estático por turno (mismo puerto), sin CI-cosas
  exóticas. `ponytail:` si Playwright da guerra con el SW en headless, se
  marca el caso y se documenta la limitación — nunca se relaja el criterio
  sin decisión del PO.
- Si el e2e pasa ya hoy (todo estaba mitigado por #23), la entrega se cierra
  con la prueba como guard — resultado válido, no fracaso.
