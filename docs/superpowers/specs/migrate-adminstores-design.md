---
Delivery-ID: migrate-adminstores
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/migrate-adminstores-design.md
---

# Migración de adminStores: reconciliación idempotente del plano de control

## Problema / Causa raíz (verificada en código)

Store OS usa una arquitectura de **doble plano** para las tiendas:

1. **`stores/{id}`** — plano de datos (business content): `whatsappPhone`, `skuPrefix`, `storefront`, productos, clientes, órdenes.
2. **`adminStores/{id}`** — plano de control (control metadata): `ownerUid`, `memberUids`, `pendingInvites`, `name`, `slug`, `type`, `retainedPrivacyRequestCount`.

Las **Security Rules leen membresía exclusivamente desde `adminStores`** (ver `firestore.rules:18-30`):

```javascript
function adminStore(storeId) {
  return get(/databases/$(database)/documents/adminStores/$(storeId)).data;
}
function isMember(storeId) {
  return isSignedIn()
    && exists(/databases/$(database)/documents/adminStores/$(storeId))
    && adminStore(storeId).memberUids.hasAny([request.auth.uid]);
}
```

La app cliente normal escribe **ambos documentos atómicamente** en una `writeBatch` (ver `firestoreData.ts:256-257`).

El test `"G-P02 store without adminStores control-plane doc is unreadable"` en `src/app/firebase/firestore.rules.test.ts:181-199` **ya existe** y pin the contract, pero falta el script de migración que repare el estado roto.

## Objetivo

Script `scripts/migrate-adminstores.cjs` que:

1. **Cree los documentos de `adminStores` que falten** a partir de `stores` — y **nada más**.
2. Corra contra el **emulador** para pruebas (`npm run emulators`).
3. **NUNCA toque producción** sin aprobación humana explícita (`--prod` + confirmación interactiva).
4. `--apply` requiera una **segunda aprobación humana** separada.

## Regla dura de dirección

`adminStores` es el plano de control **canónico** (las reglas y `seed-dev.cjs` lo declaran así). Por tanto la reconciliación es **fill-missing only**:

- Si `adminStores/{id}` **no existe** → se crea con los campos fuente (ver abajo).
- Si `adminStores/{id}` **existe** → **no se toca**. Nunca se sobreescriben `memberUids`, `ownerUid` ni `pendingInvites` desde `stores`: hacerlo puede pisar membresía autoritativa con datos viejos y bloquear miembros reales (clase del incidente de Mar).
- `stores/{id}` sin par en `adminStores` es el único defecto que repara este script.

## Campos fuente para un doc faltante

Tomados del `stores/{id}` correspondiente, igual que `projectAdminStore()` en `firestoreData.ts` y el seed (`scripts/seed-dev.cjs`):

- `storeId` — el id del documento.
- `name`, `slug`, `type` — desde `stores/{id}` (`type` es dato de control: el super_admin lista tiendas desde `adminStores` y decide la UI).
- `ownerUid`, `memberUids` — desde `stores/{id}` si los trae; si el store no tiene membresía, el script lo reporta y **lo salta** (requiere decisión humana, no adivinar).
- `pendingInvites: []`, `retainedPrivacyRequestCount: 0` — valores neutros de nacimiento.

## Flujo del script

```
node scripts/migrate-adminstores.cjs [--emulator|--prod] [--apply]
```

1. **Dry-run (default):** lista stores huérfanos, imprime por doc el payload propuesto y el total de escrituras planeadas. Cero escrituras.
2. **`--apply`:** ejecuta las escrituras (1 write por doc faltante; con una tienda real el costo es trivialmente dentro del free tier, pero el script imprime el conteo antes de confirmar).
3. **`--emulator`** apunta a `localhost:9090`; **`--prod`** exige confirmación interactiva de texto libre Y `--apply` como segundo paso explícito (doble aprobación humana, sin atajos combinados).

## Aceptación

1. Segunda corrida en dry-run reporta **0 escrituras** (idempotente).
2. Test existente `"G-P02 store without adminStores control-plane doc is unreadable"` (`firestore.rules.test.ts:181-199`) pasa; se **agrega** el caso inverso: store migrado en emulador → legible por su miembro.
3. En emulador: seed sin adminStores → script → el miembro puede leer `stores/{id}`.

## Browser check (requisito del harness)

La entrada de cola llevará un `previewChecks` mínimo: tras correr el script contra el emulador en CI, Playwright (flujo `e2e:firebase`) inicia sesión como miembro y afirma que la tienda migrada aparece en el selector "¿Quién opera hoy?". Es el check de navegador que cubre un delivery de script.

## Rollback

Los docs creados son aditivos; el rollback es borrar los `adminStores/{id}` creados por el run (el dry-run imprime los ids exactos). Ningún doc existente se modifica, así que no hay rollback de sobrescritura.


