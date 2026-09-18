# Store OS Storefront — Spec de Remediación de Rendimiento y Calidad Web

Target: `https://store-os-alpha.vercel.app/catalogo/olivia` · Auditoría 2026-09-17 · deploy `dce8d3c`
Método: inspección de repo + medición en vivo (curl contra producción) + verificación adversa (17 subagentes, 8 hallazgos P0/P1 sometidos a escépticos; 7 confirmados, 1 confirmado con correcciones menores, 0 refutados).

---

## 1. Resumen ejecutivo

La brecha móvil (FCP 5.6 s / LCP 5.9 s) vs escritorio (0.8 s / 1.0 s) **no es CPU ni imágenes**: TBT móvil = 0 ms y el ahorro por imágenes es ~27 KiB. Es una **cadena crítica de red serializada** en la que el visitante anónimo descarga la aplicación administrativa completa antes de pintar un píxel. Slow 4G (1.6 Mbps, 150 ms RTT) multiplica cada eslabón ~10×; en escritorio la misma cadena cabe en ~1 s.

Causas raíz por impacto (todas verificadas con evidencia de código y/o en vivo):

1. **Entry público = entry del admin.** `olivia.html:17` carga el mismo `/src/main.tsx`, que monta `AuthProvider` (firebase/auth) + `StoreProvider` (firestore + storage) y `App.tsx`, que importa estáticamente `AppShell` → **las 8 pantallas del panel con todos sus formularios** (`src/app/AppShell.tsx:21-28`). Chunk deployado: **1,080,892 B raw / ~289 KB gzip — el 96.7 % de todo el JS**; el visitante ejecuta ~4 % (los chunks lazy suman 36 KB raw). Firebase ocupa ~55-65 % del chunk. Hay un comentario `ponytail` admitiéndolo (`src/app/App.tsx:11-17`).
2. **Google Fonts por dos canales render-blocking.** `<link>` propio en `olivia.html:13-15` (Playfair+Jakarta) **más** un `@import` de **6 familias** (Fraunces, PJS, Archivo, Archivo Black, Playfair, Inter) que sobrevive como primera línea del CSS deployado (`src/index.css:1` → `main-DF2olf0z.css`). El `@import` se descubre solo tras bajar el CSS → cadena extra DNS+TLS+CSS que bloquea el primer paint. Es la mayor parte de los "~900 ms render-blocking".
3. **HTML vacío + fallback sin tinta.** `#root` vacío; el Suspense de la ruta pública es un `<div>` invisible (`App.tsx:40`); el primer contenido visible exige bundle completo → chunk lazy → Firestore. FCP ≈ LCP ≈ Speed Index (5.6-5.9 s) confirma que no hay paint intermedio.
4. **Firestore en frío en el camino del LCP.** La URL del hero vive dentro del doc `publicStores/olivia` (`publicCatalog.ts:129-134`): la imagen no puede *empezar* a descargarse hasta que JS ejecuta + SDK inicializa + 2 `getDoc` responden. El `<img>` del hero además no emite width/height ni `fetchpriority` (0 apariciones en el repo).
5. **robots.txt / llms.txt / sitemap.xml / favicon.ico sirven el shell HTML con 200** (883 B, `text/html`) por el rewrite catch-all (`vercel.json:10`) — origen exacto de los "22 errores de robots" y del llms.txt inválido.
6. **Contraste**: 6 pares fallan, todos trazables a 3 tokens (`--olv-accent #C97B86` = 2.95:1 sobre fondo, 2.05:1 sobre tinte; `--olv-ink-soft` 3.80:1 sobre tinte; fuga de `--terracotta-soft` admin = 2.64:1).

Corolarios: el "~44 KiB minify JS" es el delta esbuild→terser (51,386 B de whitespace, 4.75 %) — **no perseguirlo**; el "~80 KiB cache" es ~33 KiB accionables mismo-origen (90 % = logo PNG con `no-cache`), el resto (fonts CSS `private`, Firestore `no-store`) es incontrolable; los "errores de consola" no tienen fuente determinista en la app (ver §5.K).

---

## 2. Arquitectura actual (verificada)

- **Vite 5 SPA MPA-incompleto** (NO Next.js — el checklist Next del brief no aplica). Dos entradas HTML (`index.html` admin, `olivia.html` storefront) pero **una sola entrada JS** (`/src/main.tsx`).
- **Bootstrap**: StrictMode → ErrorBoundary → ThemeProvider → AuthProvider → StoreProvider → App → `registerPwa()`. SW propio (`public/sw.js`): cache-first assets, network-first navegaciones; precachea `/`, `/index.html`, manifest, icon (ni `/olivia.html` ni el logo).
- **Routing**: router propio por `popstate` (`src/app/router.ts`); rutas `public_store|category|product` renderizan storefront lazy sin shell (`App.tsx:33-44`).
- **Datos públicos**: proyecciones anónimas `publicStores/{slug}` + `publicCatalogs/{slug}` (2 reads) + `publicProducts/{storeId}__{slug}` (+1) vía `getDoc` del SDK (`src/app/firebase/publicCatalog.ts`). Solo los componentes públicos usan ese módulo.
- **SEO**: `useSeo.ts` (title/canonical/og/JSON-LD por DOM post-render) — solo en `OliviaStorefront`; `PublicCatalogScreen` nunca lo llama y `index.html` no tiene meta; el comentario de `useSeo.ts:3-8` que afirma lo contrario es falso.
- **CSS**: Tailwind 3 con tokens CSS-var (`:root` en `index.css` consumidos por clases `bg-paper` etc.) + `olivia.css` (18 KB, scoped `.olivia-root`, importado vía barrel del design-system → aterriza en el CSS compartido) + `OLIVIA_BRAND` inyectado como inline vars en `OliviaStorefront.tsx:223` (**pisa** a olivia.css).
- **Vercel** (`vercel.json`): rewrites `/catalogo/olivia(…)` → `/olivia.html`, catch-all → `/index.html`; headers solo Cache-Control (`/assets/*` immutable; resto `no-cache`). **Cero headers de seguridad** (solo HSTS de plataforma).
- **CI** (`ci.yml`): deploy solo en push a `main` (`vercel build` + `vercel deploy --prebuilt`); `VITE_VERCEL_ENV` existe como contrato (`check-env.cjs`) pero `src/` no lo consume.

```
Visitante anónimo /catalogo/olivia (Slow 4G) — cadena crítica medida:
HTML 1.3 KB (TTFB 0.22-0.75 s)
 ├─ <link> fonts.googleapis.com css2          [render-blocking] 1,741 B + DNS/TLS
 ├─ <link> /assets/main-DF2olf0z.css          [render-blocking] 49 KB raw / 10.5 KB gz
 │    └─ @import fonts.googleapis.com (6 fam) [render-blocking, descubierto TARDE] 39.7 KB raw
 └─ <script module> /assets/main-vWwxM0Ys.js  1,080,892 B raw / 288.8 KB gz ← DOMINANTE
       ↓ ejecuta: Theme→Auth→StoreProvider→App→route match
   chunk lazy OliviaStorefront 18.5K + CartDrawer 15K (+CSS)
       ↓ useEffect → getFirebase() + canal Firestore en frío (DNS/TLS/WebChannel)
   2× getDoc(publicStores, publicCatalogs) → setData → hero → LCP
```

---

## 3. Baseline (lab Lighthouse; sin CrUX — tratar como diagnóstico, no campo)

| Métrica | Móvil | Escritorio |
|---|---|---|
| Performance | **65** | 98 |
| FCP | **5.6 s** | 0.8 s |
| LCP | **5.9 s** | 1.0 s |
| TBT | 0 ms | 50 ms |
| CLS | 0.009 | 0.001 |
| Speed Index | 5.6 s | 1.1 s |

Otros: A11y 96 (contraste), Best Practices 96 (consola, sourcemaps, hardening), SEO 92 (robots inválido, 22 errores), Agentic 2/3 (llms.txt inválido).

**Mediciones en vivo que anclan el diagnóstico** (edge `cle1`, todo `x-vercel-cache: HIT`):

| Recurso | Raw | Wire (gz) | Cache-Control |
|---|---|---|---|
| `/catalogo/olivia` (HTML) | 1,310 B | 579 B | no-cache |
| fonts.googleapis css2 (`<link>`) | 1,741 B | — | private 86400 |
| `/assets/main-vWwxM0Ys.js` | **1,080,892 B** | **288,806 B** | immutable |
| `/assets/main-DF2olf0z.css` | 49,224 B | 10,546 B | immutable |
| OliviaStorefront / CartDrawer / PublicCatalog (lazy) | 18.5+15+2.7 KB | 12.5 KB | immutable |
| Playfair woff2 latin variable | 38,460 B | — | gstatic 31536000 |
| Plus Jakarta Sans woff2 latin variable | 21,688 B | — | gstatic 31536000 |
| `/images/olivia-logo.png` (PNG 600×185 sin alfa) | 29,191 B | — | **no-cache** |
| `/robots.txt` `/llms.txt` `/sitemap.xml` `/favicon.ico` | 883 B | — | **text/html** (¡index.html!) |

---

## 4. Análisis de causa raíz: ¿por qué móvil 5.6/5.9 vs escritorio 0.8/1.0?

Misma arquitectura, dos redes. TBT=0 descarta CPU. Slow 4G: RTT 150 ms (vs 40) y ~200 KB/s útiles (vs decenas de MB/s). El costo total es `Σ (RTT × saltos serializados) + bytes/1.6Mbps`:

- **Entry JS 289 KB gzip ≈ 1.5-2.0 s** solo de transferencia (más slow-start HTTP/2).
- **Cadena fonts**: `<link>` css2 (DNS+TLS+RTT ≈ 0.5-0.7 s) + `@import` encadenado dentro del CSS (otros 0.5-0.7 s) — bloquea *todo* paint.
- **Chunk lazy + CSS** tras ejecutar el entry: +0.2-0.4 s.
- **Firestore en frío** (DNS+TLS+WebChannel+2 getDoc): +0.8-1.2 s.
- Hero/img: la URL llega dentro del doc de Firestore → descarga serializada al final.

En escritorio cada término colapsa (RTT 40 ms, ancho de banda enorme) → ~1 s total. **El 5.9 s móvil se reparte aproximadamente: ~35 % entry JS, ~25 % fonts render-blocking, ~15 % ejecución+chunk, ~20 % Firestore frío, ~5 % TTFB/hero.** (Reparto estimado sobre la evidencia; la atribución fina del LCP exacto —imagen vs h1— requiere un Chrome trace real, ver §9.)

Punto clave de diseño: **ningún hallazgo aislado arregla esto**. Quitar fonts sin partir el entry deja ~4-5 s; partir el entry sin tocar fonts deja ~1 s de bloqueo. La remediación es la cadena completa.

---

## 5. Findings

Formato: evidencia → causa → impacto → solución. Prioridad/impacto/esfuerzo/riesgo en cada título. (Veredictos de verificación adversa integrados; las 2 correcciones que surgieron están reflejadas.)

### A+J. Cadena crítica / JS — Entry chunk del admin en la ruta pública 【P0 · Impacto Alto · Esfuerzo Medio · Riesgo Medio】

- **Evidencia**: `olivia.html:17` → `/src/main.tsx`; `src/main.tsx:6-7,15-16` monta Auth/StoreProvider en la raíz; `AppShell.tsx:21-28` importa estáticamente las 8 pantallas admin (+ProductForm, OrderForm, PurchasePdfImport, Suppliers…); `App.tsx:18-23` solo lazy del storefront. Byte-offsets del bundle: React+ReactDOM 0-~168K, `identitytoolkit` (auth) 316K, WebChannel 377K, `firestore.googleapis.com` 672K, `firebasestorage` 864-884K, `cloudfunctions` 1016K — Firebase ≈ 550-700 KB raw. Strings del admin ("administrador", formularios) y hasta el copy por defecto de Olivia (vía `StorefrontEditor` estático) viajan en el entry.
- **Causa raíz**: una sola entrada Vite sin frontera dinámica entre ruta pública y el árbol de providers cloud.
- **Impacto**: cada visita anónima paga ~275 KB gzip de SDK y admin que no usa; es el término dominante del FCP/LCP móvil.
- **Solución**: entry público separado (§6): `public.html` + `src/public-main.tsx` sin Auth/Store/SW; `publicCatalog` pasa a REST anónimo (fuera Firebase SDK del camino público). Objetivo: **~75-85 KB gzip** totales de JS público (~70 % menos).
- **Alternativas**: (a) solo `lazy()` de AppShell/AuthScreen/etc. en `App.tsx` — menor refactor, deja ~50-80 KB de SDK y no arregla SEO/fonts; (b) route-detect antes de montar providers — lo anticipa el comentario ponytail, pero mantiene un solo HTML (peor para fonts/SEO por-entry). Elegida: entry separado (aísla todo de una vez y habilita las fases 2).
- **Riesgos**: módulos que asumen StoreProvider/ThemeProvider en el storefront (el agente de mecánica valida: OliviaStorefront no usa `useStore`; los tokens `:root` de `index.css` sí se necesitan → extraer `tokens.css` compartido); regresión admin/demo/emuladores.
- **Mejora esperada**: FCP móvil 5.6 → ~1.2-1.8 s; LCP 5.9 → ~2.0-2.5 s (combinado con fonts y §B).

### B. LCP — Elemento, desglose y serialización 【P1 · Alto · Pequeño · Bajo】

- **Evidencia**: el HTML servido no contiene ningún `<img>` ni preload (CSR puro); la URL del hero llega en `publicStores/olivia` (`OliviaStorefront.tsx:82-86`, `publicCatalog.ts:129-134`); `ProductImage.tsx:25-32` no emite width/height/fetchpriority; variante `natural` = `w-full h-auto` sin aspect-ratio; logo `/images/olivia-logo.png` eager (compite con el hero). En prod `hero.imageUrl=None` → hoy el LCP es **texto del hero** (h1/eyebrow con Playfair tras swap); cuando la dueña suba hero, será la imagen.
- **Desglose móvil**: TTFB ~0.3-0.5 s · resource load delay ~3.5-4 s (bundle+fonts antes de conocer la URL) · load duration ~0.3 s (doc Firestore) · render delay ~1 s (canal frío+render). **El load delay domina (~65-70 %)** — de nuevo, arquitectura, no la imagen.
- **Solución**: (1) con el entry liviano la URL llega ~3 s antes; (2) `fetchpriority="high"` + `width/height` en el hero; (3) `aspect-ratio` CSS del banner para CLS; (4) logo a cache largo y sin competir por prioridad.
- **No hacer**: optimización de la imagen del hero como "causa" — la evidencia la excluye (27 KiB).

### C. Arquitectura JS / D. Code splitting 【cubierto por A】
El único splitting existente es el lazy del storefront. Con el entry público, el admin queda como segundo entry y sus pantallas pueden seguir estáticas (no es el problema a resolver ahora). `CartDrawer` ya viaja en chunk del storefront (correcto: se necesita al interactuar). No agregar `manualChunks` especulativo (YAGNI).

### E. CSS 【P1 · Alto · Pequeño · Bajo】
- **Evidencia**: `main-DF2olf0z.css` 49 KB raw / 10.5 KB gz arranca con el `@import` de 6 familias; `olivia.css` (18 KB) llega vía barrel → CSS compartido; los `:root` de tokens viven en `index.css`.
- **Causa**: un CSS global para dos audiencias (admin/storefront) + fonts remotas en `@import`.
- **Solución**: partir por entry (Vite lo hace solo al haber dos entradas con imports distintos): `tokens.css` compartido (bloque `:root` + tailwind), `index.css` solo admin (conserva su @import o self-host de las 6), `olivia.css` importado por el chunk del storefront. CSS público esperado: ~15-25 KB raw.
- **Verificación adversa (matiz)**: el CSS de assets ya es `immutable` — la penalización del `@import` aplica a visitas frías, no a cada pageview. No cambia la severidad.

### F. Fuentes 【P1 · Alto · Pequeño · Bajo】
- **Evidencia**: doble canal (`<link>` olivia.html:13-15 + `@import` index.css:1); css2 del `<link>` = 28 @font-face/11,754 B; el del `@import` = 96 bloques/39,661 B (superconjunto). Gracias a fuentes variables, **solo 2 woff2 latin se descargan de verdad** (38.5K + 21.7K = 65.7 KB) — el costo es la cadena, no los bytes. (Corrección del verificador: las cifras gzip de css2 citadas inicialmente eran ~2× optimistas; irrelevantes para la conclusión.)
- **Solución**: self-host de los **2 woff2 variables latin** en `public/fonts/` + `@font-face` con `font-display: swap` + `<link rel="preload" as="font" crossorigin>` de la del body en `public.html`; eliminar el `<link>` de Google Fonts de `olivia.html`/`public.html`; el `@import` desaparece del CSS público con el split por entry. Identidad visual intacta (mismas familias/archivos).
- **Riesgo**: baja — mismos archivos, misma renderización; fallbacks ya definidos (`Georgia`, `system-ui`).

### G. Imágenes 【P2 · Medio · Pequeño · Bajo】
- **Evidencia**: hero y logo son los `<img>` sin dimensiones que Lighthouse marca (`ProductImage.tsx:25-32`; `olivia.css:40-41` sin aspect-ratio); el **tipo** `ProductImage` ya define `width?/height?` pero `resizeImageFile` descarta las dimensiones al subirlas (`storage.ts:52-70`) y nadie las persiste (`ProductForm.tsx:184-190`) ni renderiza; logo PNG 600×185 29 KB `no-cache` sin cobertura SW; URLs de Storage = `alt=media` directas sin variantes (el único resize es client-side pre-upload, borde ≤1600 q0.8 — correcto y gratis); muestra de 17 URLs de prod: todas 200 image/jpeg.
- **Solución**: emitir `width/height` attrs cuando se conocen (props/campos) + `aspect-ratio` del banner; `fetchpriority=high` solo hero; cerrar el circuito de dimensiones (upload → persist → proyección → render); logo → cache 7d o `/assets/`.
- **Out of scope**: transformaciones de imagen en delivery (Storage transforms = de pago; viola cero-costos). `srcset` de thumbs solo si el grid lo pide con datos.

### H. Cache y red 【P2 · Medio · Pequeño · Bajo】
- **Evidencia**: `/images/*` cae en el catch-all `no-cache` (`vercel.json:22-24`); manifest/icon tienen exclusión muerta (nadie les asigna cache positivo); el SW nunca hace `cache.put` de no-navegaciones. Descomposición del "~80 KiB": ~33 KB accionables mismo-origen (90 % logo); resto incontrolable (fonts CSS `private/86400`, Firestore `no-store`).
- **Solución**: regla `vercel.json` para `/images/(.*)` → `public, max-age=604800`; limpiar exclusiones muertas; opcional: logo en el SHELL del SW.
- **Nota honesta**: el grosso del "~80 KiB" de Lighthouse no es nuestro — documentar y no perseguir.

### I. Long main-thread tasks 【P3 · Bajo · — · —】
3-5 tareas largas = parse/exec del entry de 1.08 MB. Se disuelven con el split del entry. TBT ya es 0. Sin acción específica.

### J'. Accesibilidad — contraste 【P0 corrección · Alto · Pequeño · Bajo】
6 pares fallan; todos centralizados en tokens del scope `.olivia-root` (verificado: cero impacto en temas del panel, que usan sus propias vars):

| Par (elemento) | Ratio hoy | Objetivo |
|---|---|---|
| `--olv-accent` #C97B86 sobre bg #FAF7F2 (eyebrow, labels, precios, CTA) | **2.95** | 4.5 |
| accent sobre surface #FFFDF9 | 3.10 | 4.5 |
| accent sobre `--olv-accent-soft` (precio destacado, numerales) | **2.05** | 4.5 |
| `--olv-ink-soft` #716258 sobre tinte (footer, notas, chip del contador) | 3.80 | 4.5 |
| Badge warning: accent sobre `--terracotta-soft` admin #FDE7D7 (fuga: solo `--terracotta` se remapea, `olivia.css:8`) | 2.64 | 4.5 |
| `--olv-rule` como borde de controles | 1.39 | 3.0 (1.4.11) |

**Fix validado por cálculo (un solo set, sin parches por elemento)**: `--olv-accent: #8C4550` (rosa profundo, mismo matiz: 6.38 sobre bg), `--olv-accent-soft: #F2DBDF` (tinte más claro), `--olv-ink-soft: #5E5148` (7.16 bg / 5.82 tinte), y remap `--terracotta-soft: var(--olv-accent-soft)` en `.olivia-root`. **Trampa de sync**: hay que cambiarlo en AMBOS `src/design-system/olivia.ts` (inline vars que pisan) y `src/design-system/olivia.css`. Los bordes `--olv-rule` quedan exentos (decorativos); si se quiere 1.4.11, token `--olv-rule-strong` solo en controles.
Extra: `index.html:7` (admin) tiene `maximum-scale=1.0, user-scalable=no` — quitar (el storefront ya está limpio). Alt/aria auditados: sin huecos.

### K. Best Practices — consola y sourcemaps 【P2/P3】
- **Consola**: ningún `console.error` determinista en la ruta pública (verificado: SW con catch silencioso y 4 URLs 200; manifest ni enlazado en olivia.html; Firebase v12 sin red en anónimo; StrictMode dev-only; 0 ResizeObserver; 17/17 imágenes 200). Fuente más probable real: **`/favicon.ico` servido como `text/html`** (MIME error del browser). Fix: `<link rel="icon" href="/images/olivia-logo.png">` en ambos HTML. Confirmar el texto exacto con `lighthouse --output json` antes de tocar más.
- **Sourcemaps**: off deliberado (`vite.config.ts` sin `build.sourcemap`). Dejarlo; es cosmético para Lighthouse, no perf. Para diagnóstico: `STORE_OS_SOURCEMAPS=1 npm run build` local + `.vercelignore` si algún día se deployan.

### L. Seguridad / hardening 【P2 · Medio · Pequeño · Medio】
Hoy: **solo HSTS (plataforma)**. Ausentes: CSP, XFO/frame-ancestors, COOP, XCTO, Permissions-Policy, Referrer-Policy. Inventario verificado de orígenes (CSP que no rompe nada):
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://firebasestorage.googleapis.com https://storage.googleapis.com https://*.googleusercontent.com; connect-src 'self' https://firestore.googleapis.com wss://*.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://firebasestorage.googleapis.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`.
Con self-host de fonts, bajar `fonts.googleapis/gstatic` de style/font-src. **COOP debe ser `same-origin-allow-popups`** (login con Google usa `signInWithPopup`). XFO `DENY` solo producción (preview puede necesitar iframe para Deployment Protection). **Trusted Types viable**: 0 sinks en `src/` (grep limpio) — empezar en Report-Only. Desplegar CSP como `Content-Security-Policy-Report-Only` primero, promover tras verificar admin+popup+uploads.

### M. SEO 【P0/P1/P2】
- **robots/llms/sitemap = HTML 200** (catch-all `vercel.json:10`; `public/` sin esos archivos; estáticos ganan a rewrites ⇒ basta con que existan). Fix P0: `public/robots.txt` real (`User-agent: *`, `Allow: /catalogo/`, `Disallow: /`, `Sitemap:`), `public/llms.txt` curado, favicon link.
- **og:image ausente en todas partes**: `olivia.html` no lo define y en prod `hero.imageUrl=None`, `seo.ogImageUrl=None` → el fallback de `useSeo` nunca dispara (WhatsApp/preview social roto). Fix: og:image estático (logo por URL absoluta) + llenar `storefront.seo.ogImageUrl` en el doc público. Falta canonical/og:url en `olivia.html`.
- **Tiendas genéricas sin SEO**: `PublicCatalogScreen` no llama `useSeo` y `index.html` no tiene meta; el comentario de `useSeo.ts:3-8` es falso. Fix mínimo: useSeo en PublicCatalogScreen + meta fallback en el HTML público genérico.
- **Matriz por ambiente** (usa `VITE_VERCEL_ENV`, contrato ya existente): LOCAL → irrelevante. PREVIEW → meta `noindex,nofollow` inyectada al build (`if VITE_VERCEL_ENV==='preview'` en el plugin de vite.config) + protección Vercel existente. PRODUCCIÓN → robots allow + sitemap + canonical por slug.
- **Crawlabilidad**: el HTML está vacío; Google renderiza JS pero previews sociales y crawlers sin JS no. **Etapa 2**: prerender por slug en el job deploy de CI leyendo `publicStores`/`publicCatalogs` vía **REST anónimo con la apiKey pública ya presente en el bundle** (0 secrets nuevos, 0 Functions; ~2 reads/store/deploy, free tier) → `dist/catalogo/<slug>/index.html` con meta/og/JSON-LD llenos + `dist/sitemap.xml`. Los estáticos ganan al rewrite; slugs nuevos caen al SPA público. Frescura: ventana hasta el próximo deploy + revalidación runtime del SPA (ya re-fetchea por sí mismo).

### N. llms.txt 【P3】
Rechazado por el mismo mecanismo que robots (HTML 200). El formato esperado es markdown con H1 + bloques de links. Fix barato: archivo curado describiendo el catálogo y sus rutas públicas. Valor real: bajo (no hay agentes consumiéndolo hoy); no es release blocker.

---

## 6. Arquitectura propuesta

**Principio**: primitivas de plataforma (nada Olivia-específico en infraestructura).

```
ANTES                                DESPUÉS
olivia.html ──► main.tsx             /catalogo/:slug ──► public.html ──► public-main.tsx
  Auth+StoreProvider+App               ErrorBoundary + PublicRoot(slug del path)
  AppShell+8 pantallas admin             └─ lazy storefront (editorial o genérico)
  Firebase SDK (auth+fs+storage)       publicCatalog vía REST anónimo (sin SDK)
  index.css (6 familias @import)       tokens.css + olivia.css en el chunk
  <link> Google Fonts ×2               2 woff2 self-hosted + preload
robots/llms/sitemap = index.html      archivos estáticos reales + prerender CI + sitemap
0 headers de seguridad                CSP(RO) + XCTO + COOP(same-origin-allow-popups) + …
```

Mecánica validada contra el código (agente de diseño; 4 flujos rotos silenciosos ya identificados y cerrados):

1. **Entry público** `public.html` + `src/public-main.tsx`: `StrictMode > ErrorBoundary (react-only, ya existe) > PublicRoot` + `import "./public.css"`. `PublicRoot` reutiliza `useRoute()` (`src/app/router.ts` es liviano) y replica el dispatch de `App.tsx`: `slug === OLIVIA_SLUG ? OliviaStorefront : PublicCatalogScreen`, ambos lazy. Guard: ruta no-pública → `window.location.replace("/")`. **Sin** Auth/StoreProvider/registerPwa. `vite.config.ts`: input `olivia` → `public: resolve(__dirname, "public.html")`; mantener `appType: "spa"`; añadir `public.html` a `tailwind.config` content. **No tocar los lazy de App.tsx** (siguen como fallback dev/preview; Rollup dedupe chunks compartidos). Dispatch por slug = plataforma; campo `storefront.template` solo cuando exista una 2ª tienda (YAGNI).
2. **Rewrite genérico** `/catalogo/(.*)` → `/public.html` antes del catch-all; borrar las dos reglas `/catalogo/olivia*` (único hardcodeo Olivia en infra). Sin redirect de `/olivia.html` (nunca fue URL pública). **Flujo roto #1 — crítico**: `vite dev`/`vite preview` NO aplican rewrites de vercel.json → sin corrección, todos los e2e seguirían testeando el entry ADMIN (falsa confianza total). Fix: plugin Vite (~10 líneas) con middleware idéntico en `configureServer` + `configurePreviewServer`: `^/catalogo/[^/]+` → servir `/public.html`.
3. **`publicCatalog.ts` reescrito in place a REST** (NO archivo paralelo — solo OliviaStorefront/PublicCatalogScreen/tests lo importan; `firestoreData.ts` no; los tests lo mockean por ruta y siguen válidos). Base URL espejo de `config.ts`: emulador `http://127.0.0.1:8080/v1/projects/store-os-demo/...` con `VITE_FIREBASE_EMULATOR`; prod `firestore.googleapis.com/v1/...?key=VITE_FIREBASE_API_KEY`. Mapeo: 404 → `PublicCatalogNotFoundError`/`PublicProductNotFoundError`; resto !ok → Error plano (la UI ya ofrece reintentar). **Decoder (~35 líneas puras, invertir el `toFields` de `e2e/helpers.ts:27-40`)**: `integerValue` llega como **STRING** → `Number()` obligatorio (precios); mapValue/arrayValue recursivos; `timestampValue` → ISO string (los tipos públicos no consumen fechas — verificado); clave desconocida → `throw` ruidoso. **Guard CI** `scripts/check-public-bundle.mjs` (~15 líneas, al final de `npm run build`): `dist/assets/public-*.js` no debe contener `initializeApp|getFirestore|firebase/auth` ni superar ~260 KB raw.
4. **CSS por entry — alcance real (flujo roto #2)**: `PublicCatalogScreen` usa `bg-paper`/`serif-display` (vars `:root`), `CartDrawer` usa `.price-help*` de `index.css:84-146`, `ErrorBoundary` usa `bg-ink`. Entonces `src/tokens.css` = bloque `:root` **+ base (`html,body,#root`, `body`, `.serif-display`, `.tnum`, `.price-help*`, `.rule`, keyframes fallback)**. `index.css` = @import fonts + `@import "./tokens.css"` + tailwind. `src/public.css` nuevo = `@import "./tokens.css"` + tailwind (nada más; solo `public-main.tsx` lo importa). Vite parte el CSS por entry solo. Duplicación de utilities Tailwind del admin (~10-15 KB raw) aceptada — no segundo tailwind.config (YAGNI). **Flujo roto #3**: `src/design-system/index.ts:34` tiene `import "./olivia.css"` → moverlo al tope de `OliviaStorefront.tsx` (viaja en el CSS del chunk lazy, el admin deja de pagar 18 KB). El barrel también exporta `StoreSwitcher` → cadena a StoreProvider → firebase: tree-shaking debería tumbarla del entry público pero es frágil → por eso el guard del paso 3.
5. **Fuentes**: los 2 woff2 variables latin en `public/fonts/`; `@font-face` **inline en `public.html`** (garantiza orden preload→font-face antes de la cadena CSS) con los mismos family names de los stacks, `font-weight: 400 700`, `font-display: swap`, `unicode-range` latin; preload de ambos. `olivia.html` desaparece. Admin no se toca (su @import sigue; usuario autenticado).
6. **SEO/prerender**: `public/robots.txt` + `public/llms.txt` estáticos; noindex por env extendiendo el plugin `buildMarker` existente (`transformIndexHtml` ya corre sobre todas las entradas): `VITE_VERCEL_ENV === 'preview'` → inyectar meta robots. Prerender: `scripts/prerender-public.mjs` (~80 líneas) al final de `npm run build` (vercel build lo recoge; sin tocar Build Output API): lista slugs vía REST, por slug escribe `dist/catalogo/<slug>/index.html` (meta/og/JSON-LD con el MISMO orden de prioridad que `StoreView` pasa a `useSeo`) + `dist/sitemap.xml` (solo raíces por tienda). Requiere 1 env nuevo `PUBLIC_SITE_URL` en el job deploy. Coste: 2 reads/tienda/deploy. Slugs nuevos caen al rewrite → SPA (correcto).
7. **Tokens de contraste** (§5.J').

**Nota de secuenciación**: entre "migrar a public.html genérico" y "prerender activo", los previews sociales (WhatsApp/OG) degradarían a genéricos (hoy leen los tags estáticos de olivia.html). Como el deploy solo corre en `main`, lo limpio es un solo release con Fase 1+2 juntos, o aceptar días de OG genérico.

**Presupuesto resultante (validado)**: entry público **~195-205 KB raw / 60-65 KB gzip** (react-dom ~45 gz + storefront ~17 gz) vs 289 KB gz hoy (**−78 %**). CSS público ~32 KB raw / ~6.5 KB gz + olivia.css ~4 KB gz en chunk. Fuentes 60.2 KB preloaded con swap. FCP esperado ~0.9-1.5 s, LCP ~1.5-2.2 s (texto hero; +0.3-0.6 s si hay hero-image con fetchpriority). Cumple targets sin prerender; el prerender añade margen + SEO estático. Esfuerzo total: **2.5-3.5 días** con regresión e2e completa.

---

## 7. Work breakdown (cada task = un PR atómico)

**Fase 0 — Correctness/web-quality (independientes, 1 día)**
- [ ] **PR-1 · SEO estático + headers**: `public/robots.txt` + `public/llms.txt` + `<link rel="icon">` en ambos HTML; og:image/og:url/canonical estáticos en `olivia.html`; vercel.json: `/images/*` max-age 604800, limpiar exclusiones muertas, + XCTO/XFO/COOP/Referrer-Policy/Permissions-Policy (CSP Report-Only). Validación: curl robots/llms/favicon + headers.
- [ ] **PR-2 · Contraste**: set de tokens validado en `olivia.ts` + `olivia.css` (ambos) + remap `--terracotta-soft`; + test de ratios (la spec deja los valores esperados); quitar `user-scalable=no` de `index.html`. Validación: axe + lighthouse a11y.

**Fase 1 — Cadena crítica (orden de migración validado; cada paso deja CI verde)**

- [ ] **PR-3a · CSS split + barrel**: `src/tokens.css` (`:root` + base + `.price-help*` + `.rule` + keyframes), `index.css` lo importa, mover `import "./olivia.css"` del barrel (`design-system/index.ts:34`) a `OliviaStorefront.tsx`. Verificar: main.css baja ~18 KB, vitest + e2e + e2e:firebase verdes.
- [ ] **PR-3b · REST reader in place**: reescribir `publicCatalog.ts` (fetch + decoder + errores idénticos) + test vitest del decoder con fixture REST crudo del emulador. El admin no importa el módulo (verificado).
- [ ] **PR-3c · Entry público**: `public.html` + `public-main.tsx` + `public.css`, input Vite, **middleware dev/preview** (sin él los e2e testean el entry admin — falsa confianza), rewrite genérico `/catalogo/(.*)` → `/public.html` (borrar reglas Olivia), borrar `olivia.html`, fonts self-host + preload inline, `scripts/check-public-bundle.mjs` en `npm run build`. Verificar: bundle público sin `firestore`/`identitytoolkit`, <100 KB gz, `telemetry-egress.spec` (allow-list ya permite `googleapis.com`), `public-catalog.spec` ahora ejercita entry público + REST emulador.
- [ ] **PR-4 · Imágenes/LCP**: width/height + aspect-ratio en ProductImage/banner, `fetchpriority=high` hero, circuito de dimensiones (upload→persist→proyección→render), logo cache. Validación: lighthouse sin "unsized images", CLS ≤0.01.
- [ ] **PR-5 · noindex por env + SW**: meta robots por `VITE_VERCEL_ENV` (extensión del plugin buildMarker), SW: no registrar en `/catalogo/*` o corregir la clave de `cache.put` (bug: guarda olivia.html bajo "/index.html" → offline sirve admin en la tienda).
- [ ] **PR-4 · Imágenes/LCP**: width/height + aspect-ratio en ProductImage/banner, `fetchpriority=high` hero, circuito de dimensiones (upload→persist→proyección→render), logo cache. Validación: lighthouse sin "unsized images", CLS ≤0.01.
- [ ] **PR-5 · noindex por env + SW**: inyección meta robots con `VITE_VERCEL_ENV==='preview'` (plugin vite), SW: no registrar en `/catalogo/*` o corregir la clave de `cache.put` (bug: guarda olivia.html bajo "/index.html" → offline sirve admin en la tienda).

**Fase 2 — SEO estructural**
- [ ] **PR-6 · Prerender + sitemap en CI**: `scripts/prerender-public.mjs` al final de `npm run build` (REST, apiKey pública, `PUBLIC_SITE_URL` nuevo) → `dist/catalogo/<slug>/index.html` (meta/og/JSON-LD) + `dist/sitemap.xml`; useSeo en PublicCatalogScreen + meta fallback; corregir comentario falso de `useSeo.ts`. **Shippear junto con (o inmediatamente tras) PR-3c** para evitar la ventana de OG genérico. Validación: curl al HTML prerender, rich-results/validator, Search Console robots.
- [ ] **PR-7 (opcional) · Promover CSP** a enforced tras verificar popup/ups/admin.

---

## 8. Criterios de aceptación

Móvil (lab, Slow 4G): **Perf ≥ 90 · FCP ≤ 2.0 s · LCP ≤ 2.5 s · CLS ≤ 0.1 · TBT ≤ 200 ms** (esperado: FCP ~1.2, LCP ~2.0, Perf 90-95).
Escritorio: **Perf ≥ 95 · LCP ≤ 1.5 s · CLS ≤ 0.1** (preservar ~98).
Objetivos de ingeniería verificables:
- Entry público: **< 100 KB gz** total JS inicial; `grep -c 'firestore\|identitytoolkit\|firebasestorage'` = 0 en el chunk público.
- `/robots.txt` `/llms.txt` → `200 text/plain` con contenido válido; 0 errores robots en Lighthouse.
- Lighthouse a11y: 0 fallos de contraste (verificar pares: 6.38/5.82/6.71 ≥ 4.5).
- Consola: sin errores de la app (favicon MIME resuelto).
- Headers: XCTO/COOP/XFO/Referrer-Policy presentes; CSP Report-Only sin reportes en admin+storefront+popup.
- Regresión: e2e existentes (smoke/responsive/theme + catálogo) en verde; admin y demo local intactos; `npm run typecheck && test && build` verde.

## 9. Plan de validación

1. **Local** (`npm run preview` :4319, la referencia de Preview del proyecto): `lighthouse` CLI móvil+escritorio (throttle lab estándar) antes/después de cada PR; guardar JSON en el PR.
2. **Chrome Performance trace** (DevTools, CPU 4×, Slow 4G): confirmar elemento LCP exacto y su desglose TTFB/load-delay/duration/render-delay — es la medición que el repo no puede dar y cierra la atribución (pendiente declarado).
3. **Bundle**: `npx vite-bundle-visualizer` o grep de strings prohibidos; comparar tamaños por chunk antes/después.
4. **Waterfall**: DevTools Network con "disable cache" — verificar: sin fonts.googleapis.com en la ruta pública, woff2 self-hosted, sin canal Firestore (solo 1 REST).
5. **A11y**: axe-core en la página renderizada + verificación manual de los 6 pares con los valores nuevos.
6. **SEO**: curl a robots/llms/sitemap prerender; Google Rich Results (JSON-LD Product); Search Console robots test.
7. **Regresión funcional**: `npm run e2e` (smoke+responsive+theme), `npm run e2e:firebase` para el REST reader contra emulador, flujo manual: catálogo → carrito → WhatsApp; admin: login, pedidos, editor de vitrina, subida de fotos.

## 10. Riesgos y áreas de regresión

- **Admin**: no tocar `main.tsx`/index.html más allá de lo listado; e2e admin verdes.
- **REST reader**: formato REST (nulls/timestamps/mapValue) ≠ SDK — tests unitarios de conversión + e2e emulador (REST del emulador en :8080); mantener `PublicCatalogNotFoundError` idéntico. `integerValue` llega como **string** (precio roto si no se convierte). **CORS de `firestore.googleapis.com` con `?key=`**: único punto no verificable estáticamente — verificar día 1 con un fetch desde preview local antes de mergear PR-3b/3c.
- **Falsa confianza e2e**: sin el middleware dev/preview (flujo roto #1), todos los tests siguen pasando contra el entry admin. El middleware y el guard `check-public-bundle.mjs` son lo que hace verificable la fase — no opcionales.
- **CSS split**: tokens compartidos deben cargarse en ambos entries (riesgo de vars undefined → fondo transparente) — test visual + screenshot e2e.
- **SW**: cachés viejos `store-os-v1` con `/index.html` para rutas de catálogo (offline sirve admin) — PR-5 lo cierra; bump de CACHE.
- **CSP/COOP**: popup de Google (`same-origin-allow-popups`), uploads blob:, previews — por eso Report-Only primero.
- **Prerender**: stale data hasta próximo deploy (mitigado por revalidación runtime del SPA); slugs nuevos sin prerender caen al SPA (correcto).
- **Preview protegido** (Deployment Protection): no validar Lighthouse contra preview; localhost es la referencia (decisión PO 2026-08-24).

## 11. Out of scope

- Minify terser / perseguir el "~44 KiB" (delta esbuild; muere con el split).
- Transformaciones de imagen en delivery/CDN (de pago — cero-costos).
- Datos de campo CrUX / RUM (sin telemetría en V1, por decisión de privacidad).
- og por producto en runtime (requeriría SSR dinámico) — cubierto por prerender estático.
- Performance del admin más allá del split de fonts/entry.
- Nuevas Cloud Functions, analytics, sitemap por producto individual (solo store-level + categorías).
- Rediseño visual: los tokens de contraste cambian un matiz, no la identidad.

## 12. Lo que NO se pudo confirmar desde el repo (experimentos pendientes)

1. **Elemento LCP exacto** (texto vs imagen) y desglose fino — requiere Chrome trace (§9.2). En prod hoy `hero.imageUrl=None` → casi seguro texto.
2. Texto exacto de los "errores de consola" de Lighthouse — re-correr con `--output json` y leer `errors-in-console`.
3. **CORS del REST reader con `?key=`** — verificación día 1 (§10).
4. Tamaño de la respuesta REST de `publicCatalogs/olivia` (152 productos embebidos) — medir al implementar (si >~1 MB, partir por categoría o paginar).
5. Deploy medido = `main` (`dce8d3c`); la rama actual refactoriza OliviaStorefront — re-medir tras merge para deltas exactos.

---

*Estado: aprobada 2026-09-17. Implementación por fases (PR-1..PR-6 del work breakdown); llms.txt y robots.txt ya no deben servirse como HTML — regla estática.*
