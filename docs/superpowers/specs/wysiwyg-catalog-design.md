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

## Objetivo — V1 acotada

**V1 = solo la ruta `/catalogo/olivia` y solo la dueña** (`ownerUid`). Sobre esa
ruta, la dueña puede activar un **modo edición** en el que los campos visibles
de `Storefront` se vuelven editables inline (input/textarea en el lugar, sin
formulario aparte). Al guardar, un único batch persiste todo. La clienta anónima
ve exactamente lo mismo que hoy: solo lectura; los miembros (no dueños) tampoco
ven controles de edición en V1.

- "Solo portada" significa: solo la ruta principal `/catalogo/olivia` — pero
  **todos los campos visibles de `Storefront` en ella** son editables (hero,
  historia, FAQ, envíos, pagos, horarios, instagram…).
- **No son editables en ningún caso:** productos, precios, navegación y
  etiquetas del sistema. Eso es otra entrega.

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
3. **Persistencia: draft local actualizado por `onChange` + guardado global.**
   Cada campo edita su valor en el draft vía `onChange` (feedback inmediato, sin
   escrituras); **solo el botón "Guardar" persiste**, con una sola escritura
   batch (§Persistencia). Compatible con el patrón de `StorefrontEditor` hoy:
   N ediciones = 1 guardado. El draft se descarta al salir sin guardar.
4. **Permisos V1: solo la dueña** (`ownerUid` de la tienda). Miembros y
   `super_admin` sin ser dueños no ven el chip "Editar" ni controles inline
   (pueden seguir usando el formulario de Ajustes). La clienta anónima nunca ve
   el modo edición.

## Diseño técnico

### Entrada al modo edición

- En `OliviaStorefront` (`/catalogo/olivia`), cuando la usuaria logueada es la
  **dueña** de esa tienda (`uid === store.ownerUid` con la tienda presente en
  `useStore().state.stores`), aparece un **chip flotante "Editar"** (fijo abajo,
  tap target ≥ 44px, mobile-first). Tap → modo edición. Miembros, super-admins
  sin tienda y anónimos no ven el chip.
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
- `multiline` para los textos largos; los campos tipo lista (`benefits`,
  `payments`, `hours`, `shipping`) se editan como texto "una por línea" con
  `split("\n")`, como ya lo hace el formulario
  (`StorefrontEditor.tsx:80-81,130-131`).
- **FAQ reutiliza el editor existente:** `FAQEditor`
  (`StorefrontEditor.tsx:205-…`, se exporta/mueve a su archivo si hace falta)
  gobierna agregar/quitar/editar pregunta-respuesta — no se reescribe.
  `InlineEditable` queda para los textos escalares (hero, historia, notice,
  listas por línea); no es rival del `FAQEditor`, es su complemento.
- Inputs a ≥ 16px (sin zoom en iOS), tap targets ≥ 40px.
- Cambia cualquier código → "Guardar" habilitado; error de guardado →
  `toast.error` (reusa el patrón de `StorefrontEditor.tsx:48-50`); nunca un
  falso éxito.

### Dónde se aplica

- **OliviaStorefront** (`/catalogo/olivia`): envuelve los campos visibles de
  `Storefront` de las secciones 181-297 con `InlineEditable`/`FAQEditor`. Es el
  caso de uso real y único de V1.
- **PublicCatalogScreen (tiendas genéricas)**: hoy **no renderiza ninguna
  sección de `storefront`** — solo nombre, WhatsApp y productos (verificado en
  `src/features/catalog/PublicCatalogScreen.tsx:32-56`). El chip "Editar" **no
  aparece** en tiendas genéricas y su storefront se sigue editando por el
  formulario. `ponytail:` cuando exista el render genérico, los editores inline
  se enchufan sin cambios.

### Persistencia (un batch, sin republicar productos)

Guardar ejecuta **un único `writeBatch`** con tres documentos:

1. `stores/{id}` con `storefront: draft`,
2. su espejo `adminStores/{id}` (mantiene el invariante de doble plano),
3. la proyección `publicStores/{slug}` (solo el documento de la tienda —
   **no** se republican los `publicProducts`, que no cambian).

Si el batch falla, el error **se propaga**: `toast.error` y sin éxito falso; el
draft se conserva para reintentar. En modo demo local funciona igual
(`localStorage`). **Sin cambios en `firestore.rules`**, sin colecciones nuevas,
sin Functions, sin dependencias npm.

### Costo (free tier)

Una sesión de edición completa = 3 escrituras (el batch), independiente de
cuántos campos se tocaron (draft por `onChange`, guardado único). Cero lecturas
adicionales anónimas (la clienta no cambia). Cabe holgado en el free tier.

## Pruebas

- **Unit (vitest):** `InlineEditable` — toggle lectura/edición, actualización
  del draft por `onChange`, descarte al salir, split de listas "una por línea".
  Y un test del hook de draft: cambiar N campos produce exactamente 1 batch de
  3 documentos al guardar; batch fallido → error propagado, sin éxito falso.
- **Gate de design system:** sin `<input>` crudo en los componentes nuevos
  (corre en `npm run test`).
- **E2E (Playwright, emulador/preview):** flujo dueña: login → `/catalogo/olivia`
  → chip "Editar" → editar hero.body → Guardar → toast de éxito → recargar →
  texto persistido (proyección). Flujos negativos: miembro (no dueño) y anónimo
  en `/catalogo/olivia` → sin chip ni contornos de edición; y guardado con error
  (emulador offline/fallo inyectado) → toast de error, draft intacto.

## previewChecks

```json
[
  { "path": "/catalogo/olivia", "selector": "body", "text": "Olivia" }
]
```

(La clienta anónima ve el sitio público; el flujo de edición de la dueña corre
en e2e con emulador — requiere sesión.)

## Out of scope (explícito)

- Reordenar/ocultar productos y categorías → `unified-products`.
- Editor visual de layout/colores (tokens de tema, ya existente).
- Multi-idioma, Rich text/markdown, carga de imágenes inline (el flujo de
  imágenes ya existe en el formulario y en productos).
- Render del storefront en tiendas genéricas.
