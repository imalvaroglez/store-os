---
Delivery-ID: refresh-hard-reload
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/refresh-hard-reload-design.md
---

# Refresh y hard reload confiables

## Problema

Tras cada deploy, las usuarias ven contenido obsoleto al refrescar e incluso con
hard reload (Ctrl+Shift+R). Ladueña dijo textualmente: *"refresh should work as
refresh"*. Hoy es release-blocker del debt cycle.

## Causa raíz (confirmada en código)

- `public/sw.js:4` fija `const CACHE = "store-os-v1"` — el nombre del caché **nunca
  cambia entre deploys**, así que el service worker (que sí hace `skipWaiting()` y
  `clientsClaim()`) sirve contenido viejo que nunca se invalida.
- No existe negociación de versión ni aviso de "nueva versión disponible"
  (`src/pwa.ts` registra `/sw.js` sin `onUpdate`).
- Desajuste de caché: `vercel.json` cachea `/assets/*` 1 año (inmutable, correcto
  para ficheros con hash), pero `public/sw.js` usa **cache-first** para los assets
  del SHELL — lo que acopla la shell fija a una versión de app.

## Objetivo

Que, tras un deploy, una recarga normal (y la primera tras reabrir la pestaña)
sirva siempre la versión nueva, sin acción manual de la usuaria, respetando el
costo cero y el modo demo local.

## Alcance (in)

- Versionar el nombre del caché del service worker para que cada deploy invalide
  el anterior.
- Asegurar que la **navegación (HTML)** sea siempre network-first y que, al
  activar el SW nuevo, se borre el caché de la versión anterior.
- Mantener los assets con hash (`/assets/*`) como inmutables (1 año) — son
 ireccionados por el HTML fresco, no necesitan invalidación.
- Un único mecanismo, simple, sin UI de "update disponible" en V1 (YAGNI: el
  versionado del caché + `skipWaiting`/`clientsClaim` ya entrega la versión nueva
  al refrescar; un prompt es alcance adicional, fuera de este item).

## Fuera de alcance (out)

- `vite-plugin-pwa` / Workbox / precache automático (la app tiene un SW manual
  mínimo; migrar a un plugin es otra entrega).
- UI de "hay una nueva versión, recarga" (se deja para si el mecanismo automático
  no basta en producción).
- Web Push o notificaciones.

## Diseño

1. **Cache version derivado del build.** El nombre del caché pasa de `"store-os-v1"`
   a algo que cambia por deploy. Opciones:
   - **(A) Inyectar un hash/versión en build.** `vite.config.ts` define un
     `__APP_VERSION__` (ej. `Date.now()` en build, o el commit SHA corto) que
     `public/sw.js` lee. Como el SW actual es estático en `public/`, se reescribe
     en build o se sirve como módulo con el define de Vite.
   - **(B) Cache version por nombre de asset.** El SW lee la URL del script actual
     (que lleva hash) y la usa como versión de caché.
   - **Recomendado: (A)** con un valor inyectado por Vite, por ser explícito y
     auditable. `ponytail:` si (B) resulta más simple sin paso de build extra.

2. **Limpieza del caché viejo en `activate`.** Iterar `caches.keys()` y borrar los
   que no coincidan con la versión actual. Es el patrón estándar; hoy no se hace.

3. **Navegación network-first confirmada.** `public/sw.js:27-31` ya lo es; se deja
   y se documenta. Los assets con hash pueden quedar cache-first (son inmutables).

4. **Registro con `autoUpdate`.** `src/pwa.ts` registra el SW; confirmar que tras
   `skipWaiting` la recarga sirva la nueva versión. Si el flujo lo requiere, llamar
   `navigator.serviceWorker.getRegistration()` y forzar la activación, **sin UI**.

## Criterios de aceptación

- Un test (vitest sobre la lógica de versión de caché, o e2e que simule un SW viejo)
  demuestra que al cambiar la versión del caché, `caches.keys()` ya no contiene la
  clave anterior tras `activate`.
- `npm run typecheck && npm run test && npm run build` pasan.
- El nombre del caché ya no es un literal estático `store-os-v1`; depende del build.
- Tras un deploy (Preview), una recarga normal sirve el contenido nuevo (verificado
  manualmente por el PO en el preview check; el harness ejecutará el previewCheck
  declarado).
- Sin regresión: el modo demo local (sin backend) sigue cargando offline con la
  shell inicial.

## previewChecks

```json
[{ "path": "/", "selector": "body", "text": "Entrar" }]
```

## Riesgos / notas

- Si la versión del caché se deriva de `Date.now()` en build, dos builds del mismo
  commit tendrán versiones distintas (aceptable; esperado en CI).
- El SW vive en `/sw.js` (public); cualquier cambio al SW en runtime requiere que el
  navegador lo re-descargue (lo hace por defecto al cambiar el bytes del archivo).

## Dependencias

Ninguna (`dependsOn: []`).
