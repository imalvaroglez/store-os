---
Delivery-ID: persist-entity-error-handling
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/persist-entity-error-handling-design.md
---

# Manejo consistente de errores al guardar

## Problema

En modo cloud, guardar o borrar una entidad puede fallar (Firestore rechaza la escritura: permiso, red, cuota) y hoy la respuesta del app depende de **qué** entidad sea:

- **Algunas rutas esperan y propagan** (`addStore`, `updateStore`, `upsertProduct`, `upsertPurchase`, `transferStoreOwnership`): `persistEntity` re-throwa y la pantalla puede avisar.
- **Muchas rutas son fire-and-forget silencioso** — dispatch local + `void persistEntity(...).catch(() => {})`: la UI muestra éxito, Firestore nunca recibió el dato, y al recargar el cambio **desaparece**. Es pérdida de trabajo confirmable.
- **Todos los borrados** (`deleteEntity(...).catch(() => {})`) y las **escrituras derivadas** (reserva de inventario al guardar un pedido, proyecciones públicas) fallan igual de callados: fantasmas en Firestore que reaparecen tras refresh.

La operadora (Olivia/Mar en producción) no tiene forma de saber que algo no se guardó.

## Causa raíz verificada en código

- **`src/app/StoreProvider.tsx:276-284`** — `persistEntity` loguea y re-throwa (bien), pero nada obliga a los callers a esperar el resultado.
- **Swallows en writes de entidades** — `void persistEntity(...).catch(() => {})` en: `inviteMember` (`:362`, `:370`), `removeMember` (`:380`), `upsertCategory` (`:446`), `upsertSupplier` (`:480`), `upsertCustomer` (`:498`), `upsertOrder` (`:518`, `:522`), `deleteOrder` (`:531`).
- **Swallows en deletes** — `deleteEntity(...).catch(() => {})` en `deleteProduct` (`:428`), `deleteCategory` (`:464`), `deleteSupplier` (`:484`), `deletePurchase` (`:494`), `deleteCustomer` (`:502`), `deleteOrder` (`:534`).
- **Swallows en proyecciones/derivados** — `projectPublicForStore` (`:299`, `:456`, `:473`), `removePublicProductDoc`/`rebuildPublicCatalog` (`:431`, `:435`), `deleteProductImage` (`:438`).
- **`StoreProvider` está fuera de `ToastProvider`** (`src/app/App.tsx:76-85`; montado en `main.tsx`): el provider no puede lanzar toasts directamente — necesita un canal propio.

## Objetivo

**Ninguna escritura fallida es invisible.** Toda operación iniciada por la usuaria termina en una de dos: confirmación real, o un mensaje accionable en español ("No se pudo guardar X. Reintentar"). Sin colas offline, sin reintentos automáticos con backoff — esta entrega es honestidad, no sincronización.

## Alcance (in)

### 1. Contrato uniforme en `StoreProvider`

- Todos los métodos de mutación del contexto (`upsertCategory`, `upsertSupplier`, `upsertCustomer`, `upsertOrder`, `deleteProduct`, `deleteCategory`, `deleteSupplier`, `deletePurchase`, `deleteCustomer`, `deleteOrder`, `removeMember`, `inviteMember`) pasan a `async` y **propagan** el error de persistencia, como ya hacen `upsertProduct`/`upsertPurchase`. Los tipos del contexto (`StoreContextValue`) se actualizan; los callers que hoy ignoran el retorno siguen compilando (Promise ignorada) pero los de UI de usuario pasan a hacer `try/catch`.
- El dispatch optimista local se mantiene (local-first): el estado local nunca se revierte por diseño; el error se **reporta**, y el snapshot de Firestore reconcilia al recargar.

### 2. Un solo canal de error de sincronización

- `persistEntity`/`deleteEntity` dejan de tragar en background: nuevos helpers `persistInBackground`/`deleteInBackground` que capturan, loguean con contexto, y publican en el nuevo estado de contexto `syncError: { label: string; retry: () => Promise<void> } | null` (una sola ranura — el último error gana; `retry` re-ejecuta la escritura fallida con closure y limpia la ranura al lograrlo).
- `App` (dentro de `ToastProvider`) renderiza, cuando `syncError` existe, un banner discreto fijo arriba: texto del label + botón "Reintentar" + "Descartar". Tokens del sistema de diseño (`bg-surface`, `text-danger`…), sin estilos hardcodeados.
- Las proyecciones públicas (`projectPublicForStore` y familia) usan el mismo canal con label "publicar el catálogo" — sigue sin bloquear el guardado principal, pero deja de ser invisible (con "Republicar catálogo" ya existente como salida manual).

### 3. Pantallas

- Las pantallas que llaman mutaciones ahora propagadas (`CategoriesScreen`, `SuppliersScreen`/`SupplierForm` callers, `CustomersScreen`, `OrdersScreen`, borramientos con confirmación) hacen `try/catch` y muestran toast de error vía `useToast`, igual que `PurchaseForm` hace hoy (`src/features/inventory/PurchaseForm.tsx:109`).
- Mensajes en español de México, concretos: "No se pudo guardar la categoría." etc. Sin jerga técnica; el detalle técnico vive en `console.error` (ya existente).

## Alcance (out)

- Cola offline / persistencia de reintentos / backoff — si se necesita, otra entrega.
- Reversión del estado local optimista (rollback del reducer).
- Reintentos automáticos de proyecciones públicas.
- Cambios en reglas de Firestore o en el modo demo local (sin red, no falla nada).

## Pruebas

- **Unitarias** (`vitest`, extendiendo `src/app/StoreProvider.reducer.test.ts` / un test nuevo del provider con adaptador cloud falso):
  - un `saveEntity` que rechaza → `syncError` queda seteado con label y `retry`; el `retry` exitoso lo limpia.
  - los métodos propagados rechazan (promise rejection) cuando el adaptador falla.
  - el dispatch local ocurre aunque la persistencia falle (optimista intacto).
- **Estáticas existentes** (`npm run test`) siguen en verde; gate de design-system cubre el banner (sin `<button>` crudo).
- **E2E (`e2e:firebase`)**: con el emulador, forzar un rechazo de permisos (escribir una entidad ajena) y ver el banner + toast, no un éxito falso. Si forzar el rechazo resulta artificioso en emulador, se cubre con la unitaria del provider y se deja constancia.

## Preview check

```json
{ "path": "/", "selector": "body", "text": "Entrar" }
```

## Estimación de costo

Cero: solo código cliente; ninguna escritura nueva contra Firestore (mismas operaciones, ahora reportadas).
