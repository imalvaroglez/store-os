---
Delivery-ID: refresh-hard-reload
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/refresh-hard-reload-design.md
---

# Refresh y hard reload confiables

## Problema

La dueña reporta que, tras promover code changes, hay que refrescar (a veces con
hard reload) para ver el estado nuevo: *"refresh should work as refresh"*. Es
release-blocker del mini-ciclo (ver `docs/BACKLOG.md` §"Deuda técnica").

El backlog enumera **cuatro hipótesis** para este síntoma amplio, en orden de
probabilidad:

1. Caché del service worker / PWA devolviendo el bundle viejo tras un deploy.
2. `subscribeCloudState` no descubre documentos nuevos cuando el query inicial
   cargó vacío (caso dual-plane).
3. `browserLocalPersistence` rehidratando sesión/state de IndexedDB viejos.
4. Cabeceras de caché de Vercel para `index.html` y assets.

Esta entrega **no asume** cuál es la causa. Primero reproduce el síntoma A→B sobre
una URL estable; luego aplica el endurecimiento que el código confirma que falta.

## Estado real del código (verificado)

Antes de diseñar, se inspeccionó el código actual. Lo que **ya existe y funciona**
— no se debe repetir ni reclamar como trabajo nuevo:

- `public/sw.js:14-21` — el handler `activate` **ya** itera `caches.keys()` y
  borra toda clave distinta de `CACHE`. La limpieza de cachés anteriores existe.
- `public/sw.js:27-31` — la navegación **ya es network-first**
  (`fetch(req).catch(() => caches.match("/index.html"))`). Los assets con hash
  quedan cache-first (son inmutables; correcto).
- `public/sw.js:4` — `const CACHE = "store-os-v1"` es un literal estático, pero
  como `activate` sí limpia cachés viejos, el único efecto de no versionar es que
  el **mismo nombre** se reutiliza: el SW precachea el `SHELL` de nuevo en
  `install` y, al activar, no hay clave "vieja" que borrar porque el nombre no
  cambió. No es, por sí solo, la causa confirmada del síntoma.
- `public/sw.js:5` — el `SHELL` precacheado es solo
  `["/", "/index.html", "/manifest.webmanifest", "/icon.svg"]`. **`/assets/*` no se
  guarda en Cache Storage**; la app los pide a la red y, al llevar hash en el
  nombre, el HTML fresco los direcciona.
- `src/pwa.ts` registra `/sw.js` manualmente (sin `vite-plugin-pwa`/Workbox);
  `autoUpdate`/`onUpdate` son APIs de esos plugins y **no existen aquí**.
- `vercel.json:12-17` — el **único** `Cache-Control` es para `/assets/*`
  (`public, max-age=31536000, immutable`). `index.html`, `/sw.js`,
  `/manifest.webmanifest` e `/icon.svg` **no tienen cabecera explícita** y caen al
  default de Vercel.
- `define` de Vite **no transforma** archivos dentro de `public/` (se sirven
  estáticos); cualquier versión inyectada en `sw.js` requiere un paso de build que
  reescriba el archivo, no un `define`.

## Objetivo

Que un refresh del navegador (normal y la primera tras reabrir pestaña) sirva
siempre estado fresco tras un deploy — sin acción manual de la usuaria y sin
asumir la causa antes de reproducirla. Respeta costo cero y modo demo local.

## Alcance (in)

1. **Reproducir A→B sobre una URL estable.** Desplegar un marcador visible (ej.
   un texto/versión en `index.html` o un componente raíz) en Preview (dev
   backend), cargar la URL estable en una pestaña limpia, promover un cambio B
   con un marcador distinto, y confirmar si el refresh normal muestra B. Sin este
   paso no se toca el SW ni se versiona nada.

2. **Endurecimiento HTTP mínimo (confirmado que falta).** Añadir en `vercel.json`
   cabeceras `Cache-Control: no-cache` (o `no-store` para `/sw.js`) para
   `index.html` y `/sw.js`, de modo que el HTML y el script del SW no sean
   servidos por un caché HTTP intermedio (browser o CDN) tras un deploy. Esto es
   independiente de la hipótesis SW: el navegador revalida el HTML y re-descarga
   el SW cuando cambian sus bytes.

3. **Actualizar el fallback HTML del SW.** El fallback offline actual
   (`caches.match("/index.html")`) sirve la shell precacheada. Tras un deploy con
   SW nuevo, esa entrada cacheada puede ser de la versión anterior hasta que el SW
   termine de reinstalar el `SHELL`. Garantizar que el `install` reprecachea el
   `SHELL` fresco y que el fallback sea consistente con la versión nueva.

4. **Versionado del caché por build — solo si la reproducción lo demuestra.** Si
   A→B reproduce que el problema es el SW (no CDN, no listener, no Auth), y solo
   en ese caso, cambiar `CACHE` de literal estático a un valor que varíe por
   deploy. Como `define` no aplica a `public/`, la opción simple es que el script
   de build genere el `CACHE` (ej. escribir el SHA corto o un timestamp en
   `dist/sw.js` durante `vite build`). `ponytail:` preferir la opción más simple
   que la reproducción justifique; si el endurecimiento HTTP (#2) ya resuelve el
   síntoma, **no** versionar (YAGNI).

## Fuera de alcance (out)

- `vite-plugin-pwa` / Workbox / precache automático (otra entrega).
- UI de "hay una nueva versión, recarga" (se deja solo si el mecanismo automático
  no basta **tras** confirmarse en producción).
- Web Push o notificaciones.
- Investigar las hipótesis #2 (listener de Firestore) y #3 (Auth persistence)
  aquí: si la reproducción A→B descarta que sea un problema de caché de archivos
  estáticos, esos síntomas de dato estancado se rastrean como item separado
  (están documentados en `docs/BACKLOG.md` y en memoria
  `dual-plane-membership-sync`).

## Diseño

1. **Reproducción A→B (primer entregable, bloqueante).**
   - Añadir un marcador ligero y exclusivo por build en la UI (ej. versión corta
     en `index.html` o un nodo en `App`), **visible solo para diagnóstico**, que
     no afecte el flujo productivo.
   - En Preview (`store-os-dev`), cargar la URL estable `/` en una pestaña sin
     estado previo (o tras `bypass` de SW).
   - Promover el build B con un marcador distinto. Refrescar **normal** (sin
     Shift). Registrar: ¿aparece B? ¿Aparece solo con hard reload? ¿Solo tras
     cerrar todas las pestañas?
   - El resultado decide si se aplica #4 o si basta #2.

2. **Cabeceras `Cache-Control` en `vercel.json`** para `index.html` y `/sw.js`:
   - `/sw.js` → `no-cache` (debe revalidarse siempre; el navegador lo
     re-descarga si sus bytes cambiaron — clave para que el SW nuevo se instale).
   - `/index.html` → `no-cache` (revalidar; el HTML fresco referencia los assets
     nuevos con hash).
   - `/assets/*` se mantiene `immutable` (ya está; correcto).

3. **Fallback HTML consistente.** Confirmar que `install` reprecachea `SHELL`
   tras cada deploy y que `activate` (que ya limpia) quede consistente. Si la
   reproducción muestra que la shell cacheada estanca la UI, opcionalmente
   descachear la shell vieja por nombre antes de reclamar clientes.

4. **Versionado condicional (solo si A→B lo exige).** Generar `CACHE` en build
   reescribiendo `dist/sw.js`, o leer la URL del script del SW con hash como
   versión. Mínimo código; documentar el `ponytail:` con su techo.

## Criterios de aceptación

- **Reproducción documentada.** Un registro (en la evidencia de la entrega) del
  experimento A→B sobre la URL estable de Preview: marcadores, resultado del
  refresh normal vs. hard reload, y conclusión sobre cuál hipótesis reproduce.
- `index.html` y `/sw.js` se sirven con `Cache-Control` que obliga a revalidar
  (verificable con `curl -I` contra el deploy de Preview).
- `npm run typecheck && npm run test && npm run build` pasan.
- **Sin regresión de offline:** el modo demo local (sin backend) sigue cargando
  offline con la shell inicial (test e2e existente o verificación manual).
- Si se aplicó versionado (#4): un test (vitest sobre la función de versión, o
  e2e que simule SW viejo) demuestra que el caché viejo se descarta tras
  `activate`. **Si no se aplicó** (porque #2 bastó): no se agrega este test — no
  tiene sentido testear limpieza de caché que ya existía antes de esta entrega.
- previewCheck: el refresh normal sobre la URL estable sirve el marcador B sin
  hard reload (verificado por el PO; el harness ejecuta el previewCheck declarado).

## previewChecks

```json
[{ "path": "/", "selector": "body", "text": "Entrar" }]
```

## Riesgos / notas

- El marcador diagnóstico A→B debe ser removible o inerte en producción; no es
  una feature de UI.
- `no-cache` en `index.html` no rompe offline: el SW aún precachea `/` y lo sirve
  offline vía el fallback network-first de `sw.js:27-31`.
- Si la reproducción A→B **no** reproduce con archivos estáticos, el síntoma es de
  dato (hipótesis #2/#3) y esta entrega se cierra con solo el endurecimiento HTTP
  (#2), dejando el rastreo del dato estancado para otro item.

## Dependencias

Ninguna (`dependsOn: []`).
