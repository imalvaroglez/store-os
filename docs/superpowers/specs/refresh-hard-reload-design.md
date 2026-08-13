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

1. **Reproducir A→B sobre una URL estable, registrando evidencia técnica.**
   Desplegar un marcador visible y **exclusivo por build** (ej. versión corta o
   hash en `index.html` o un nodo raíz), cargar la URL estable en una pestaña
   limpia, promover un cambio B con marcador distinto en el **mismo origen**, y
   confirmar si el refresh normal muestra B. En cada paso registrar:
   - Hash del bundle JS servido (el `<script src="/assets/index-*.js">` del HTML).
   - Cuerpo y cabeceras de la respuesta de `index.html` (`Cache-Control`, `ETag`).
   - Versión/SHA del SW que controla la página
     (`navigator.serviceWorker.controller.scriptURL` + `state`).
   El resultado decide cuál hipótesis reproduce. **Sin este paso no se toca el SW
   ni se versiona nada.**

2. **Endurecimiento HTTP + registro (confirmado que falta).** Dos cambios
   complementarios e independientes de la hipótesis:
   - `vercel.json`: cabeceras `Cache-Control` para `index.html` y `/sw.js` que
     obliguen a revalidar (el navegador revalida el HTML y re-descarga el SW
     cuando cambian sus bytes). `/assets/*` se mantiene `immutable` (ya está).
   - `src/pwa.ts`: registrar el SW con `updateViaCache: "none"`, para que el
     chequeo de actualización del SW **bypassea el caché HTTP** del script. Hoy el
     registro no pasa opciones → default `"all"` → el browser puede servir el SW
     cacheado. `updateViaCache` controla solo el script del SW y sus imports, no
     los assets.

3. **Actualizar el fallback HTML tras una navegación online exitosa.** El fallback
   offline actual (`caches.match("/index.html")` en `sw.js:29`) sirve la shell
   precacheada. La garantía es: tras una navegación **online** que trajo el HTML
   nuevo, el fallback cacheado debe reflejar esa versión nueva (no la shell vieja
   que dejó un deploy anterior). El `install` reprecachea `SHELL` y el cache-first
   de `/index.html` se refresca con la respuesta online exitosa, de modo que un
   posterior offline sirva la versión vista por última vez en línea.

4. **Versionado del caché por build — solo si la reproducción lo demuestra.** Si
   A→B reproduce que el problema es el ciclo del SW (no CDN, no listener, no Auth),
   y solo en ese caso, cambiar `CACHE` de literal estático a un valor que varíe por
   deploy. Como `define` no aplica a `public/`, la opción simple es que el script
   de build genere el `CACHE` (ej. escribir el SHA corto en `dist/sw.js` durante
   `vite build`). `ponytail:` preferir la opción más simple que la reproducción
   justifique; si el endurecimiento (#2) ya resuelve el síntoma, **no** versionar
   (YAGNI).

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
   - Marcador exclusivo por build (ej. `__APP_VERSION__` corta inyectada, o un
     texto en `index.html` reescrito en build), **visible solo para diagnóstico**.
   - En Preview (`store-os-dev`), sobre el **mismo origen** estable, cargar A en
     una pestaña limpia. Capturar: `<script src="/assets/index-*.js">` servido
     (hash del bundle), cuerpo + `Cache-Control`/`ETag` de `index.html`, y
     `navigator.serviceWorker.controller` (scriptURL + state).
   - Deployar B (mismo origen, marcador distinto). Refrescar **normal** (sin
     Shift). Recapturar los tres datos. Registrar: ¿aparece B? ¿Solo con hard
     reload? ¿Solo tras cerrar todas las pestañas? ¿El `controller` cambió?
   - La brecha entre lo servido y lo esperado señala la hipótesis: HTML cacheado
     por CDN/browser (cabeceras), SW que no actualiza (`updateViaCache`/ciclo), o
     bundle correcto pero dato estancado (listener/Auth → item separado).

2. **Cabeceras `Cache-Control` en `vercel.json`** para `index.html` y `/sw.js`:
   - `/sw.js` → `Cache-Control: no-cache` (revalidar siempre; el navegador lo
     re-descarga si sus bytes cambiaron — clave para que el SW nuevo se instale).
   - `/index.html` → `Cache-Control: no-cache` (revalidar; el HTML fresco
     referencia los assets nuevos con hash).
   - `/assets/*` se mantiene `immutable` (ya está; correcto).

3. **Registro con `updateViaCache: "none"`** en `src/pwa.ts`:
   `navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })`.
   Complementario a la cabecera: la cabecera controla el caché HTTP del script si
   el browser lo consulta; `updateViaCache: "none"` hace que el browser no lo
   consulte en el chequeo de actualización. Defensa en profundidad.

4. **Fallback HTML consistente.** Tras una navegación online exitosa, el
   `/index.html` que el SW cachea (vía `install` addAll y la respuesta network del
   handler navigate) debe ser la versión nueva. Garantizar que el handler
   network-first (`sw.js:27-31`) persista la respuesta online exitosa en el caché
   del `SHELL`, de modo que el offline posterior sirva la última versión vista en
   línea — no la shell vieja de un deploy anterior.

5. **Versionado condicional (solo si A→B lo exige).** Generar `CACHE` en build
   reescribiendo `dist/sw.js`, o leer la URL del script del SW con hash como
   versión. Mínimo código; documentar el `ponytail:` con su techo.

## Criterios de aceptación

- **Reproducción documentada.** Registro del experimento A→B sobre la URL estable
  de Preview con los tres datos (bundle hash, `index.html` cuerpo+cabeceras, SW
  `controller`) en A y en B, y conclusión sobre cuál hipótesis reproduce.
- `index.html` y `/sw.js` se sirven con `Cache-Control: no-cache`
  (verificable con `curl -I` contra el deploy de Preview).
- `src/pwa.ts` registra el SW con `updateViaCache: "none"`.
- `npm run typecheck && npm run test && npm run build` pasan.
- **Sin regresión de offline:** tras el experimento, desconectar red y recargar;
  la app carga con la shell (la última versión vista online, no una vieja).
  Verificado con un test e2e o manual en el emulador/local.
- **Marcador de B sin hard reload:** tras deployar B en el mismo origen, un
  refresh normal sirve el marcador exclusivo de B (no A). `text: "Entrar"` no
  cuenta — es estático; el previewCheck usa el marcador exclusivo del build.
- Si se aplicó versionado (#5): un test demuestra que el caché viejo se descarta
  tras `activate`. **Si no se aplicó** (porque #2+#3 bastaron): no se agrega — no
  tiene sentido testear limpieza de caché que ya existía antes de esta entrega.

## previewChecks

```json
[{ "path": "/", "selector": "[data-build-marker]", "text": "" }]
```

El marcador de build (`data-build-marker` con valor exclusivo por deploy) es lo
que afirma que cargó la versión nueva. Un `text: "Entrar"` estático no demuestra
que se sirvió el deploy B.

## Riesgos / notas

- El marcador diagnóstico A→B debe ser removible o inerte en producción; no es
  una feature de UI. Si se queda, es un atributo `data-*` invisible, no texto.
- `no-cache` en `index.html` no rompe offline: el SW aún precachea `/` y lo sirve
  offline vía el fallback network-first de `sw.js:27-31`.
- `updateViaCache: "none"` no afecta los assets del app; solo el script del SW.
- Si la reproducción A→B **no** reproduce con archivos estáticos (el bundle y el
  HTML sí rotan pero el dato sigue estancado), el síntoma es de dato (hipótesis
  #2/#3) y esta entrega se cierra con el endurecimiento (#2+#3), dejando el
  rastreo del dato para otro item.

## Dependencias

Ninguna (`dependsOn: []`).
