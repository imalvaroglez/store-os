---
Delivery-ID: wysiwyg-catalog
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/wysiwyg-catalog-design.md
---
# Edición WYSIWYG del catálogo público in-place

## Problema / Causa raíz (verificada en código)

Hoy el contenido público se edita desde **Ajustes de tienda → StorefrontEditor**
(`src/features/catalog/StorefrontEditor.tsx:16-194`): un formulario largo,
desconectado de lo que la clienta ve. Fer quiere editar el texto público
**directamente sobre la vista pública** — click en el texto → editar → ver el
resultado en contexto.

El modelo ya existe y es suficiente (no hay nada de CMS que inventar):

- `Storefront` / `StorefrontSection` en `src/types/index.ts:46-78` — campos
  estructurados, cada uno mapea a una sección fija de la vista pública
  (`OliviaStorefront.tsx` renderiza hero, benefits, notice, story, resale, FAQ,
  hours/shipping/payments/instagram en `src/features/catalog/OliviaStorefront.tsx:181-297`).
- La persistencia ya escribe en ambos planos: `updateStore()` en
  `src/app/StoreProvider.tsx:266-280` persiste `stores/{id}` vía `persistEntity`
  y **siempre** re-proyecta a `publicStores/{slug}` vía `projectPublicForStore`
  (que copia `storefront` en `src/app/firebase/firestoreData.ts:342-351`). Es
  decir: guardar = 1 escritura en `stores` + las escrituras de la proyección
  pública existente. Sin cambios de modelo ni de reglas.

La clienta anónima lee solo la proyección (`loadPublicCatalog`,
`src/app/firebase/publicCatalog.ts:111-138`) y jamás ve controles de edición.

## Objetivo

Sobre `/catalogo/:slug`, una usuaria **logueada con acceso a esa tienda** puede
activar un **modo edición** en el que los textos públicos visibles se vuelven
editables inline (input/textarea en el lugar, sin formulario aparte). Al
guardar, persiste por la vía existente (`updateStore`), que ya re-publica la
proyección. La clienta anónima ve exactamente lo mismo que hoy: solo lectura.

**No es un CMS**: solo los campos de `Storefront` que ya se renderizan como
texto en la vista pública. Sin layout arrastrable, sin secciones nuevas, sin
dependencias nuevas.

## Decisiones (cierran las 4 preguntas abiertas del backlog)

1. **Campos editables in-place** (los que se ven como texto en la vista pública):
   `hero.heading`, `hero.body`, `benefits`, `story.heading`, `story.body`,
   `resale.heading`, `resale.body`, `notice`, `faq` (agregar/quitar/editar
   pregunta-respuesta), `hours`, `shipping`, `payments`, `instagram`.
   **Quedan fuera del WYSIWYG** (siguen en el formulario de Ajustes):
   `seo.*`, `whatsappBuyIntro`, `whatsappResaleIntro`, `showSoldOut` y los
   campos URL (`hero.imageUrl`, `logoUrl`, `seo.ogImageUrl`) — meter URLs a
   ciegas inline es peor UX que el formulario, y los intros de WhatsApp tienen
   contexto auto-agregado que no debe borrarse por accidente.
2. **Alcance: solo storefront.** Reordenar/ocultar productos y categorías es la
   otra cara de la entrega `unified-products`; no se toca aquí.
3. **Persistencia: modo edición con guardado global** (draft local + un solo
   `updateStore` al "Guardar"). Igual patrón que `StorefrontEditor` hoy
   (`src/features/catalog/StorefrontEditor.tsx:42-53`): un solo clic escribe
   `stores` + proyección pública. Guardar por campo on-blur multiplicaría las
   escrituras ~10x por sesión de edición — innecesario y en contra del
   presupuesto de 20K escrituras/día. El draft se descarta al salir sin guardar.
4. **Permisos: cualquier miembro con acceso a la tienda** (dueño o `memberUid`),
   igual que el `StorefrontEditor` actual (accesible desde los Ajustes de tienda
   que ya ve un miembro). `super_admin` sin tienda activa no edita storefront:
   el botón de edición solo aparece cuando el slug corresponde a una tienda
   presente en `state.stores` de `StoreProvider`. La clienta anónima nunca ve
   el modo edición.

## Diseño técnico

### Entrada al modo edición

- En `PublicCatalogScreen` y `OliviaStorefront`, cuando la usuaria está
  logueada, la vista pública detecta si el `slug` corresponde a una tienda de
  `useStore().state.stores` y muestra un **chip flotante "Editar"** (fijo abajo,
  tap target ≥ 44px, mobile-first). Tap → modo edición.
- En modo edición la vista **no lee la proyección anónima**: renderiza desde la
  tienda de `StoreProvider` (datos de la sesión), de modo que el draft refleja
  el estado fresco de la dueña, no una proyección que podría estar desfasada.
- Un banner fino superior ("Estás editando tu sitio público") con acciones
  **Guardar** / **Salir sin guardar**. El banner usa tokens del sistema de
  diseño (`bg-surface`, `text-on-surface`); nada de colores hardcodeados.

### Primitiva de edición inline

Un componente único y pequeño, `InlineEditable` (en
`src/features/catalog/`, exportado sin tocar el barrel global):

```tsx
<InlineEditable
  value={draft.hero?.body}
  placeholder="Mensaje principal"
  multiline
  onSave={(v) => patchDraft({ hero: { ...draft.hero, body: v || undefined } })}
/>
```

- Modo lectura: renderiza el texto tal cual hoy + un contorno punteado sutil
  (`ring-1 ring-dashed` con token de borde del tema) y un ícono de lápiz
  pequeño. Tap → cambia a `TextField`/`TextArea` del sistema de diseño (sin
  `<input>` crudo — lo exige el gate del design system).
- `multiline` para body/FAQ/pagos; los campos tipo lista (`benefits`,
  `payments`, `faq`) se editan como texto "una por línea" con `split("\n")`,
  exactamente como ya lo hace el formulario
  (`StorefrontEditor.tsx:80-81,130-131`).
- Inputs a ≥ 16px (sin zoom en iOS), tap targets ≥ 40px.
- Cambia cualquier código → "Guardar" habilitado; error de guardado →
  `toast.error` (reusa el patrón de `StorefrontEditor.tsx:48-50`); nunca un
  falso éxito.

### Dónde se aplica

- **OliviaStorefront** (`/catalogo/olivia`): envuelve los textos de las
  secciones 181-297 con `InlineEditable`. Es el caso de uso real y único hoy.
- **PublicCatalogScreen (tiendas genéricas)**: hoy **no renderiza ninguna
  sección de `storefront`** — solo nombre, WhatsApp y productos (verificado en
  `src/features/catalog/PublicCatalogScreen.tsx:32-56`). Mientras eso no
  cambie, aquí no hay nada que editar in-place: el chip "Editar" **no aparece**
  en tiendas genéricas y su storefront se sigue editando por el formulario.
  Renderizar el storefront genérico es trabajo de la entrega `unified-products`,
  no de esta. `ponytail:` cuando ese render exista, `InlineEditable` se enchufa
  sin cambios.

### Persistencia (sin cambios de infraestructura)

Guardar = `updateStore({ id, storefront: draft })` (StoreProvider ya persiste
`stores` y re-proyecta `publicStores` en el mismo flujo,
`src/app/StoreProvider.tsx:266-280`). En modo demo local funciona igual
(`localStorage`). **Sin cambios en `firestore.rules`**, sin colecciones nuevas,
sin Functions, sin dependencias npm.

### Costo (free tier)

Una sesión de edición completa = lo mismo que guardar el formulario hoy: 1
escritura de `stores` + la re-proyección pública existente. Cero lecturas
adicionales anónimas (la clienta no cambia). Cabe holgado en el free tier.

## Pruebas

- **Unit (vitest):** `InlineEditable` — toggle lectura/edición, guardado de
  valor, descarte al salir, split de listas "una por línea". Y un test del hook
  de draft: cambiar N campos produce exactamente 1 `updateStore` al guardar.
- **Gate de design system:** sin `<input>` crudo en los componentes nuevos
  (corre en `npm run test`).
- **E2E (Playwright, emulador/preview):** flujo dueña: login → `/catalogo/olivia`
  → chip "Editar" → editar hero.body → Guardar → toast de éxito → recargar →
  texto persistido (proyección). Y flujo anónimo: `/catalogo/olivia` sin sesión
  → sin chip, sin contorno de edición, contenido legible.

## previewChecks

- `path: /catalogo/olivia` · `selector: h1` · `text: <hero.heading o nombre de tienda>` — la clienta anónima ve el hero sin controles de edición.
- `path: /catalogo/olivia` · `selector: [data-testid="edit-mode-chip"]` · `absent` — sin sesión no existe el chip "Editar".

(Los checks del flujo completo de edición corren en e2e con emulador —
requieren sesión — y no en el preview anónimo.)

## Out of scope (explícito)

- Reordenar/ocultar productos y categorías → `unified-products`.
- Editor visual de layout/colores (tokens de tema, ya existente).
- Multi-idioma, Rich text/markdown, carga de imágenes inline (el flujo de
  imágenes ya existe en el formulario y en productos).
- Render del storefront en tiendas genéricas.
