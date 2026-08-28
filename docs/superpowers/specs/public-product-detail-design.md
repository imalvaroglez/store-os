---
Delivery-ID: public-product-detail
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/public-product-detail-design.md
---
# Catálogo público: detalle de producto inaccesible (storeId ausente en publicStores estancado)

## Problema

En el storefront público de Olivia, **todo** click en un producto del grid
termina en "Pieza no encontrada / Tal vez se retiró del catálogo"
(`OliviaStorefront.tsx:471-483`). El bug está vivo en producción
(`store-os-f7cf8`) y en dev (`store-os-dev`), verificado por REST el
2026-08-28.

**Causa raíz verificada con datos reales, no hipótesis:**

1. `loadPublicProduct` (`src/app/firebase/publicCatalog.ts`) obtiene el
   `storeId` desde `publicStores/{slug}` y lanza `PublicCatalogNotFoundError`
   si falta (`publicCatalog.ts:151`).
2. El commit `390e76a` (2026-08-04) movió esa lectura desde
   `publicCatalogs/{slug}` → `publicStores/{slug}`. El comentario del bloque
   `/**` de la función (líneas 129-137) **todavía describe la fuente antigua**:
   el código nunca implementó lo que promete.
3. El doc `publicStores/olivia` de ambos backends es de una publicación
   anterior al cambio y **no tiene** el campo `storeId` (campos REST:
   `name, slug, storefront, type, whatsappPhone`).
4. En cambio `publicCatalogs/olivia` **sí** tiene `storeId: "store_olivia"` en
   ambos backends, y los 23 docs `publicProducts/store_olivia__{slug}` existen.

Cadena del fallo: la lista sale del array `products[]` de `publicCatalogs` ✓ →
click → `loadPublicProduct` muere en `:151` **antes** de intentar leer el
producto → `OliviaStorefront.tsx:410-413` mapea `PublicCatalogNotFoundError`
al branch "notfound" → "Pieza no encontrada". El mensaje es idéntico al de un
producto inexistente, por eso parecía "el producto no existe".

**Descartado con evidencia:** reglas Firestore (las 3 colecciones públicas son
`allow read: if true`, `firestore.rules:217-244`), routing (`router.ts:16-21`),
rewrites de hosting (`vercel.json:7-8`), permisos, y el refactor ponytail
(#53 — no toca la resolución; `loadPublicProduct` intacto desde `390e76a`).

## Objetivo

1. Cualquier visitante anónimo puede abrir el detalle de un producto público
   aunque el doc `publicStores` de la tienda sea anterior a `390e76a` (sin
   `storeId`), leyendo el `storeId` de `publicCatalogs/{slug}` como respaldo.
2. Ningún producto sin slug vuelve a proyectarse al grid público (card con
   link `/catalogo/{slug}/producto/null` → mismo síntoma).
3. Sin migración de datos ni republicación manual: el fix de código resuelve
   con los datos actuales de ambos backends.

## Alcance (in)

### 1. Fallback self-contained en `loadPublicProduct` (`src/app/firebase/publicCatalog.ts:151`)

```ts
if (!store.storeId) {
  // publicStores anterior a 390e76a no trae storeId; publicCatalogs siempre
  // lo trajo (+1 lectura sólo en el caso estancado).
  const catSnap = await getDoc(doc(db, "publicCatalogs", storeSlug));
  const catStoreId = catSnap.exists()
    ? (catSnap.data() as { storeId?: string }).storeId
    : undefined;
  if (!catStoreId) throw new PublicCatalogNotFoundError(storeSlug);
  store = { ...store, storeId: catStoreId };
}
```

- Sin cambio de firma, sin exports nuevos, sin cache. Cubre también la ruta
  `knownStore`.
- Self-contained por diseño: `loadPublicProduct` es la única puerta al detalle
  público (`ProductView`/`StoreView` son hermanos sin estado compartido, y la
  entrada directa por URL —SEO— no tendría cache de todas formas). Costo: +1
  lectura **solo** en el caso estancado.
- Si tampoco existe `publicCatalogs/{slug}`, `PublicCatalogNotFoundError` es
  el error correcto (tienda sin publicar) y el caller ya lo mapea a
  "Pieza no encontrada".
- Actualizar el comentario `/**` para describir el fallback real (hoy describe
  una fuente que el código no tenía).

### 2. Guard null-slug en el punto compartido (`src/app/firebase/firestoreData.ts:535`)

Bug latente de la misma familia (NO es la causa de este incidente: hoy ningún
producto del resumen real tiene slug null). `ProductMiniForm`
(`PurchaseForm.tsx:750-768`) publica productos **sin** slug; el proyector
escribe el summary con `productSlug: null` incondicionalmente
(`:474`, `:509`, `:642`) pero el detail doc solo si hay slug (`:587`,
`:633/:637`) → card con link `/producto/null` → "Pieza no encontrada".

```ts
function isPublished(p: Product): boolean {
  if (!p.slug) return false; // sin slug no hay doc público direccionable: card muerta
  return p.status ? p.status === "published" : p.isPublic;
}
```

- Un guard en el punto compartido cubre a todos los callers (`:557`, `:635`,
  `:662`, …). Borrar el `if (!p.slug) continue;` de `:587` (queda muerto; su
  comentario "a migrated product always has a slug" asumía exactamente lo que
  `ProductMiniForm` viola).
- **No** se mintea slug en `ProductMiniForm`: duplicaría `uniqueProductSlug`
  a mitad del flujo de compra.
- `isPublished` se exporta y se cubre con test unitario en
  `src/app/firebase/firestoreData.test.ts` (con slug → true, sin slug → false,
  draft → false). Sin `vi.mock`: sería el primero del repo para un `if` de 5
  líneas; el loader se cubre con e2e.

### 3. e2e que reproduce el bug (`e2e/public-catalog.spec.ts`)

Helper de seed vía REST `seedStaleOlivia()` (mismo estilo que
`seedPublicProjection`): `publicStores/olivia` **sin** `storeId` +
`publicCatalogs/olivia` **con** `storeId: "store_olivia"` + 1 summary +
`publicProducts/store_olivia__{slug}` con el shape de detail.

Test: visitante anónimo abre el catálogo "olivia" → click en la card del
producto → el heading con el nombre del producto es visible y
`getByText("Pieza no encontrada")` tiene count 0. **Debe fallar antes del fix
y pasar después** — ese rojo registrado es la evidencia del bug.

## Alcance (out)

- Republicar el catálogo o backfill de `publicStores` (innecesario tras el fix;
  existe `scripts/backfill-public-product-store-ids.cjs` para otro caso).
- Cambiar `PublicCatalogScreen` para que las tiendas no-Olivia enlacen
  productos (el detalle hoy solo existe en Olivia; otra entrega).
- Cache del `storeId`, cambio de firma de `loadPublicProduct`, nuevos exports.
- Mintear slugs en `ProductMiniForm`.

## Criterios de aceptación

1. Con el shape estancado del seed (`publicStores` sin `storeId`), el e2e nuevo
   falla antes del fix y pasa después; el resto de `e2e/public-catalog.spec.ts`
   no regresa.
2. Con los datos reales de dev y prod (sin cambiar nada en Firestore), el
   detalle `/catalogo/olivia/producto/anillo-blossom` renderiza la pieza.
3. Un producto publicado sin slug no aparece en el grid público (ni produce
   links `/producto/null`).
4. `npm run typecheck && npm run test && npm run build` verdes; `npm run
   test:rules` verde (toca `src/app/firebase/`).
5. Sin dependencias nuevas; UI 100% español; sin cambios visuales (es fix de
   datos, la UI ya existía).

## previewChecks

```json
[
  { "path": "/catalogo/olivia/producto/anillo-blossom", "selector": "body", "text": "Anillo Blossom" }
]
```

(El preview del deploy candidato debe mostrar la pieza con el shape estancado
de producción — la prueba visual de que el bug murió.)

## Notas de implementación

- Dos commits: (1) fallback + comentario, (2) guard `isPublished` + unit test
  + limpieza de `:587`. Un solo PR de implementación con `Delivery-ID`.
- El flujo e2e usa Firebase Emulator (nunca datos de producción), per LOOPS.
- La lectura extra del fallback solo ocurre en tiendas estancadas; una vez
  republicadas, el path rápido (`store.storeId`) vuelve a ser el único que se
  ejecuta.
