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

1. **Reconcilie `adminStores` desde `stores`** (o viceversa) de forma idempotente.
2. Corra contra el **emulador** para pruebas (`npm run emulators`).
3. **NUNCA toque producción** sin aprobación humana explícita (`--prod` + confirmación interactiva).
4. `--apply` requiera una **segunda aprobación humana** separada.

