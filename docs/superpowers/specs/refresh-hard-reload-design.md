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
  borra toda clave distinta de `CACHE`. La limpieza existe, pero es **dead code
  hoy**: como `CACHE` nunca cambia de nombre, `filter(k => k !== CACHE)` nunca
  encuentra nada que borrar. Solo haría algo si se versionara el nombre del caché
  (que es justamente el punto 5, condicional).
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
   Desplegar un marcador visible y **exclusivo por build** (mecanismo en #1bis),
   cargar la URL estable en una pestaña limpia, promover un cambio B con marcador
   distinto en el **mismo origen**, y confirmar si el refresh normal muestra B. En
   cada paso registrar:
   - El `<meta name="x-build">` servido (SHA corto del commit que construyó el
     HTML) — es la prueba directa de qué deploy se sirvió.
   - Hash del bundle JS servido (el `<script src="/assets/index-*.js">` del HTML).
   - Cuerpo y cabeceras de la respuesta de `index.html` (`Cache-Control`, `ETag`).
   - Versión/SHA del SW que controla la página
     (`navigator.serviceWorker.controller.scriptURL` + `state`).
   El resultado decide cuál hipótesis reproduce. **Sin este paso no se toca el SW
   ni se versiona nada.**

   **1bis. Mecanismo del marcador de build (definido).** Dos formas complementarias,
   ambas con el mismo SHA corto (`git rev-parse --short HEAD`):
   - `<meta name="x-build" content="<sha-corto>">` inyectada por un plugin de Vite
     con hook `transformIndexHtml` en el `<head>` de `index.html` y `olivia.html`
     (ambas son entradas declaradas de Vite en `vite.config.ts` rollupOptions.input,
     así que el hook corre en ambas — no son archivos estáticos de `public/`). Es lo
     que el experimento A→B inspecciona en el HTML servido.
   - Un nodo `<div data-build-marker="<sha-corto>">` en el shell de React, visible
     pero visualmente oculto (clase `.sr-only` del design system, manteniendo
     `display:block` para que el browser lo cuente como visible). El SHA va también
     como `innerText`. Es lo que el previewCheck valida (el harness requiere un
     elemento visible con `innerText`, ver `previewChecks`).
   El SHA es **exclusivo por commit**, vive dentro del HTML/bundle (no en `public/`),
   y el experimento inspecciona el mismo artefacto que el SW cachea. En dev, el
   plugin puede inyectar `"dev"` y el nodo renderizar "dev".

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

3. **Fallback HTML: persistir la respuesta online (código NUEVO en el handler
   navigate).** El handler `navigate` actual (`sw.js:27-31`,
   `fetch(req).catch(() => caches.match("/index.html"))`) **no** escribe la
   respuesta online en el caché — solo la sirve y cae a fallback si falla. Esta
   entrega lo **modifica** para que, en la rama online exitosa, haga además
   `cache.put(SHELL_CACHE, "/index.html", onlineResponse.clone())`. Así cada
   navegación online refresca el fallback, viva o no un SW nuevo (defensa frente a
   "el SW nuevo no llegó"; detalle y justificación en Diseño #4).

4. **Versionado del caché por build — casi descartado.** El caché rota sin
   versionar (`addAll` sobrescribe en cada `install`, Diseño #4; y el `cache.put`
   del punto anterior refresca por navegación). El `activate` que "limpia cachés
   viejos" es dead code hoy y no necesita hacer nada. El versionado solo se
   justificaría si A→B mostrara stale **offline** que ni `addAll` ni el `put`
   resuelvan — un caso que no esperamos. Si se da, se genera `CACHE` en build
   reescribiendo `dist/sw.js` (no `define`; no transforma `public/`). `ponytail:`
   probablemente YAGNI; la reproducción decide, no el diseño. (Mapea a Diseño #5.)

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
   - Marcador exclusivo por build vía plugin `transformIndexHtml` en
     `vite.config.ts` (ver #1bis): `<meta name="x-build" content="<sha-corto>">`.
   - **Origen del experimento: `http://localhost:4319` (vite preview).** El deploy
     de Vercel se hace por GitHub Actions (`vercel deploy --prebuilt`), que solo
     genera la URL commit-specific — no hay URL de branch estable donde el caché y
     el SW persistan entre A y B (ver `.github/workflows/ci.yml:239-241`). Por eso
     la reproducción se hace en local: `vite preview` sirve en el mismo
     puerto/origen estable entre builds, el SW y el caché del browser persisten, y
     tengo control total sin tocar prod. Procedimiento:
     - `npm run build` con marcador A; `npm run preview` (puerto 4319); abrir
       `http://localhost:4319` en pestaña limpia.
     - Capturar: el meta `x-build`, el `<script src="/assets/index-*.js">` servido
       (hash del bundle), cuerpo + cabeceras de `index.html`, y
       `navigator.serviceWorker.controller` (scriptURL + state).
     - Cambiar el marcador a B, rebuild, y volver a servir en el **mismo** 4319
       (mismo origen). Refrescar **normal** (sin Shift). Recapturar los cuatro
       datos.
   - Registrar: ¿aparece B? ¿Solo con hard reload? ¿Solo tras cerrar todas las
     pestañas? ¿El `controller` cambió? La brecha entre lo servido y lo esperado
     señala la hipótesis: SW que no actualiza (`updateViaCache`/ciclo), o bundle
     correcto pero dato estancado (listener/Auth → item separado).
   - **Limitación honesta de la reproducción local:** las cabeceras
     `Cache-Control` de Vercel no aplican en `vite preview` (el servidor de
     preview no es Vercel). Por eso la hipótesis "cabeceras de Vercel" (#4 del
     backlog) **no se reproduce ni se descarta en local** — se cierra por
     configuración: verifico que `vercel.json` lleve `no-cache` en `index.html` y
     `/sw.js`, y se confirma en producción cuando llegue el dominio. El
     endurecimiento (#2) se aplica igual porque es correcto tenga o no la causa.
   - **Reproducción (diagnóstico, ANTES del fix).** Se corre sobre el código
     actual (sin fix): mismo procedimiento de abajo (contexto persistente, A→B,
     recarga normal), pero **no afirma éxito** — registra si meta sigue A
     (reproduce el bug) o pasa a B (no reproduce). Su salida identifica la
     hipótesis. Puede ser un test etiquetado (`@repro`, fuera de CI por defecto) o
     una corrida registrada en la evidencia. Si reproduce (meta=A tras recarga),
     confirma que el endurecimiento (#2/#3/#4) es el área a tocar.
   - **Regresión (gate, DESPUÉS del fix).** Test de Playwright en `npm run e2e`,
     con el fix aplicado. La clave de diseño (fácil de hacer mal → falso verde):
     usar **`launchPersistentContext` con un `userDataDir` dedicado**, NO un
     browser fresco por defecto. Un browser nuevo nunca tiene SW registrado, así
     que nunca reproduciría el stale — daría verde sin probar nada. El
     `userDataDir` persiste el SW de A entre los dos pasos. Procedimiento:
     1. Servir build A en `http://localhost:4319` (vite preview, marcador A).
        Abrir una página en el contexto persistente, dejar que el SW se registre y
        `clients.claim()`. Capturar el meta `x-build` y el
        `navigator.serviceWorker.controller.scriptURL`.
     2. Detener el servidor de preview, reemplazar `dist/` con build B (mismo
        origen, marcador B), levantar de nuevo en el **mismo** puerto 4319.
     3. **Esperar `controllerchange`** (ver punto siguiente) y entonces recarga
        **normal** (sin bypass de caché). Afirmar: el meta `x-build` cambió a B
        **sin** hard reload.
     4. Desconectar red (contexto offline de Playwright) y recargar: afirmar que
        la app carga con el fallback (shell) y que el meta sigue siendo B (no una
        versión vieja estancada).
   - **Cuidado con la race del control + con bytes del SW idénticos.** (a) Antes de
     afirmar meta=B, el test **espera** el evento `controllerchange`
     (`navigator.serviceWorker.addEventListener("controllerchange", …)` envuelto en
     una promesa con timeout) y entonces recarga; sin eso, la recarga puede estar
     controlada aún por el SW viejo y el test es flaky. (b) Si entre A y B **solo**
     cambió el marcador del HTML, los bytes de `/sw.js` son idénticos → el browser
     no detecta un SW nuevo → no instala → la ruta de update del SW no se ejercita.
     Eso es revelador: el mecanismo que entrega B en el caso online es el
     **navigate network-first** (trae el HTML nuevo sin importar el SW) + que el
     HTML no esté estancado por caché HTTP — que es justo lo que endurecen #2 y #3.
     Para ejercitar además la ruta del SW (opcional), build B puede cambiar un byte
     de `/sw.js` (ej. un comentario con el SHA); pero el caso real y común es que el
     SW no cambia y el fix Network es el que cuenta.

2. **Cabeceras `Cache-Control` en `vercel.json`** para `index.html` y `/sw.js`:
   - `/sw.js` → `Cache-Control: no-cache` (revalidar siempre; el navegador lo
     re-descarga si sus bytes cambiaron — clave para que el SW nuevo se instale).
   - `/index.html` → `Cache-Control: no-cache` (revalidar; el HTML fresco
     referencia los assets nuevos con hash).
   - `/assets/*` se mantiene `immutable` (ya está; correcto).

3. **Registro con `updateViaCache: "none"`** en `src/pwa.ts`:
   `navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })`. **No
   es redundante con la cabecera `no-cache` de `/sw.js` (#2)** — cubren ventanas
   distintas (confirmado contra la spec W3C y el artículo de Chrome "Fresher
   service workers, by default"):

   | Evento | `updateViaCache:"none"` | `Cache-Control: no-cache` en `/sw.js` |
   |---|---|---|
   | Update check (SW ya registrado) | ✅ browser no consulta el caché HTTP | parcial (solo si el browser consulta) |
   | **Carga inicial** (primera visita, sin SW) | ❌ no hay registro aún → no rige | ✅ obliga a revalidar |
   | CDN de Vercel cacheando `/sw.js` | ❌ no aplica | ✅ la CDN respeta la cabecera |

   `updateViaCache` solo controla el chequeo de actualización del SW; la **primera
   carga** del script sigue el caché HTTP normal (browser o CDN), y ahí solo la
   cabecera defiende. Por eso se necesitan ambas: la cabecera protege la carga
   inicial y la CDN; `updateViaCache` protege los update checks. Belt-and-suspenders
   justificado, no redundante.

4. **Fallback HTML consistente (código NUEVO; defensa frente a "el SW nuevo no
   llegó").** `Cache.addAll()` **sobrescribe** la entrada previa de `/index.html`
   en cada `install` del SW nuevo (confirmado: la Cache Storage API reemplaza la
   respuesta existente para la misma URL). Así que, en condiciones normales, el
   fallback ya rota: cada SW nuevo reinstala el `SHELL` y deja `index.html@B` en la
   key. **PERO** ese refresco depende de que un SW nuevo se descargue e instale. Si
   por cualquier razón el SW nuevo no llega (fallos de red en el check,
   `updateViaCache` sin efecto, browser que no revalida `/sw.js`), el handler
   navigate del SW viejo sigue sirviendo `index.html@A` desde el fallback —
   estancado indefinidamente. Por eso esta entrega **modifica** el handler
   `navigate` (`sw.js:27-31`, antes-state) para que en la rama online exitosa haga
   además un `cache.put`:
   ```
   // after-state (shape)
   const res = await fetch(req);
   const cache = await caches.open(CACHE);
   cache.put("/index.html", res.clone()).catch(() => {});
   return res;
   ```
   Es una segunda vía de rotación que no depende del ciclo de instalación del SW:
   cada navegación online refresca el fallback, venga o no un SW nuevo. Cinturón
   (`addAll` en install) + tirantes (`cache.put` en navigate): belt-and-suspenders
   intencional, porque el stale offline es silencioso (la usuaria no ve error, solo
   contenido viejo).

5. **Versionado condicional (casi descartado).** Análisis honesto: el `activate`
   que "limpia cachés viejos" (`sw.js:14-21`) es **dead code hoy** — como el
   nombre `CACHE` nunca cambia, `filter(k => k !== CACHE)` nunca borra nada. Y no
   necesita hacerlo: `addAll` sobrescribe (#4) y el handler navigate persiste la
   online (#4), así que el caché rota sin versionar. El versionado solo se
   justificaría si A→B mostrara stale **offline** que ni `addAll` ni el persist
   online resuelven (un caso que no esperamos, pero dejamos abierto). Si se da,
   la opción es generar `CACHE` en build reescribiendo `dist/sw.js` (no `define`;
   no transforma `public/`). `ponytail:` probablemente YAGNI — la decisión final
   la toma la reproducción, no el diseño.

## Criterios de aceptación

- **Reproducción (diagnóstico, ANTES del fix).** Un paso que se corre sobre el
  `sw.js`/`pwa.ts`/`vercel.json` **actuales** (sin fix): sirve build A, registra el
  SW, sirve build B en el mismo origen, recarga normal, y **registra** si meta sigue
  siendo A (reproduce) o pasa a B (no reproduce). Su salida **identifica la
  hipótesis**; no afirma éxito. Puede ser un test etiquetado (`@repro`, skip en CI
  por defecto) o una corrida manual registrada en la evidencia.
- **Regresión (gate, DESPUÉS del fix).** Un test de Playwright (en `npm run e2e`)
  con contexto persistente (`launchPersistentContext` + `userDataDir`) que, con el
  fix aplicado, afirma que meta cambia a B sin hard reload y que el offline sirve
  B. Este es el gate de aceptación; depende del fix, por eso no puede hacer el
  papel de reproducción.
- **Cabeceras verificadas por config (no por runtime local).** Un test en CI (o
  unitario) afirma que `vercel.json` declara `Cache-Control: no-cache` para
  `source: "/sw.js"` y `source: "/index.html"`. No se verifica con `curl -I`
  contra Preview: el deploy es commit-specific (sin URL estable) y `vite preview`
  local no sirve las cabeceras de Vercel. La confirmación de runtime en Vercel es
  **diferida** y **no** es gate de aceptación: se valida en producción cuando
  llegue el dominio.
- `src/pwa.ts` registra el SW con `updateViaCache: "none"`.
- `npm run typecheck && npm run test && npm run build` pasan.
- **Sin regresión de offline:** el paso 4 del test de regresión (offline en
  Playwright tras el A→B) afirma que la app carga con el fallback y que el meta
  sigue siendo B — no una shell vieja estancada.
- Si se aplicó versionado (Diseño #5): un test demuestra que el caché viejo se
  descarta tras `activate`. **Si no se aplicó** (porque #2+#3+#4 bastaron): no se
  agrega — no tiene sentido testear limpieza de caché que ya existía antes de esta
  entrega.

## previewChecks

```json
[{ "path": "/", "selector": "[data-build-marker]", "text": "<sha-corto>" }]
```

`text` lleva el **SHA corto concreto** esperado del build que se valida (no
vacío). El harness (`scripts/delivery-harness.cjs:1425-1428`) hace
`locator.waitFor({state:"visible"})` + `innerText().includes(text)` — por eso el
marcador no puede ser solo un `<meta>` (un meta en `<head>` no es "visible" ni
tiene `innerText`, y `text:""` pasa vacuamente porque `"".includes("")===true`).
El marcador es un **nodo del DOM visible** con el SHA como texto (ver #1bis).

## Riesgos / notas

- El marcador de build son dos cosas: (1) `<meta name="x-build">` para
  inspección/SW, y (2) un nodo `<div data-build-marker>` **visible pero
  visualmente oculto** (`.sr-only` del design system, `display:block` para que
  cuente como visible) en el shell de React, con el SHA corto como `innerText`.
  Lo segundo es lo que el previewCheck valida; lo primero es lo que el
  experimento A→B inspecciona en el HTML servido. No es una feature de UI; se
  queda en producción porque saber qué build corre un reporte de bug vale más que
  la limpieza de quitarlo.
- `no-cache` en `index.html` no rompe offline: el SW aún precachea `/` y lo sirve
  offline vía el fallback network-first de `sw.js:27-31`.
- `updateViaCache: "none"` no afecta los assets del app; solo el script del SW.
- Si la reproducción A→B **no** reproduce con archivos estáticos (el bundle y el
  HTML sí rotan pero el dato sigue estancado), el síntoma es de dato (hipótesis
  #2/#3) y esta entrega se cierra con el endurecimiento (#2+#3), dejando el
  rastreo del dato para otro item.

## Dependencias

Ninguna (`dependsOn: []`).
