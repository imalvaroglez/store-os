---
Delivery-ID: reliable-member-invitations
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/reliable-member-invitations-design.md
dependsOn: [platform-users-view]
---

# Invitar miembros por correo (flujo confiable)

## Problema

Invitar a una persona a operar una tienda hoy es un flujo frágil con tres fallas confirmadas en producción (caso Mar):

1. **`pendingInvites` nunca se reconcilian.** Cuando la persona invitada por email sí crea cuenta (típicamente con Google), nada la agrega a `memberUids`: la invitación queda "pendiente" para siempre y la tienda nunca le aparece en el selector.
2. **`findUidByEmail` compara string exacto** (`src/app/firebase/auth.ts:97-103`), sin normalizar. Si Google entrega el email canonicalizado distinto a como se escribió en la invitación (mayúsculas, puntos de Gmail), la búsqueda falla y la invitación cae a `pendingInvites` aunque la cuenta ya exista.
3. **Doble plano de membresía.** `stores` y `adminStores` cargan copias de `memberUids`/`pendingInvites` y las reglas leen exclusivamente `adminStores`. Hoy el chokepoint `saveEntity` ya batchea ambos (`src/app/firebase/firestoreData.ts:249-260`), pero este diseño añade un **tercer** escritor (la auto-reconciliación del invitado) y debe respetar el mismo invariante: cualquier mutación de membresía escribe ambos planos en la misma `writeBatch`.

Además, memoria de incidente: el popup de Google falla con `auth/unauthorized-domain` en dominios no autorizados de Firebase Console. No es arreglable en código, pero hoy el error crudo confunde; debe traducirse.

Decisiones cerradas del PO (`docs/BACKLOG.md:50-54` y `143-162`): reusar `pendingInvites` + regla por-email (ponytail, sin colección nueva); la UI invita eligiendo de la lista de usuarios existentes (no email a ciegas); la normalización de email va en esta misma entrega.

## Causa raíz verificada en código

- **Verificado en `src/app/StoreProvider.tsx:299-320`** — `inviteMember` busca uid por email exacto; si no lo halla, agrega el email a `pendingInvites` y envía `sendInviteLink`. No existe ninguna ruta que después mueva ese email a `memberUids`: `grep -rn "reconcil" src` da cero resultados.
- **Verificado en `src/app/firebase/auth.ts:36-53`** — `ensureUserDoc` corre en cada login (email y Google) pero solo crea/lee `users/{uid}`; nunca consulta `pendingInvites`.
- **Verificado en `src/app/firebase/auth.ts:97-103`** — `findUidByEmail` hace `where("email", "==", email.toLowerCase().trim())` contra el string guardado; sin normalización de puntos de Gmail.
- **Verificado en `firestore.rules:18-30`** — `isMember`/`isOwner` resuelven exclusivamente desde `adminStores/{storeId}`.
- **Verificado en `firestore.rules:67-88` y `89-99`** — `adminStores.update` exige `isOwner`; `stores.list` solo lista por `memberUids`. Un invitado sin membresía **no puede** hoy ni descubrir la tienda que lo invita ni auto-agregarse: la reconciliación requiere un cambio de reglas.
- **Verificado en `src/app/firebase/firestoreData.ts:249-260`** — toda escritura de `stores` batchea también `adminStores` vía `projectAdminStore` (`src/app/firebase/firestoreData.ts:199-212`).
- **Verificado en `src/features/stores/StoreSettingsScreen.tsx:34-55,134-146`** — la UI de invitar hoy es solo un input de email libre.
- **Verificado en `src/app/firebase/auth.ts:68-71`** — `signInWithGoogle` usa `signInWithPopup` sin manejar `auth/unauthorized-domain`.

## Objetivo

Que invitar a alguien a operar una tienda funcione de punta a punta sin intervención manual: invitar desde la lista de usuarios existentes (o por email como respaldo), y que al iniciar sesión —con email o Google— la persona vea la tienda en el selector "¿Quién opera hoy?" y la invitación desaparezca de "pendientes".

## Alcance (in)

### 1. Invitar por selector (usuarios existentes)

En `StoreSettingsScreen` (hoja de miembros), el flujo principal deja de ser email a ciegas:

- Un botón "Agregar miembro existente" abre un selector que lista usuarios de `users/{uid}` (fetch con `getDocs(collection(db, "users"))`, mismo patrón que `platform-users-view`).
- Elegir un usuario agrega su **uid** directamente a `memberUids` vía `updateStore` + `persistEntity("stores", ...)` — ya existe la cuenta, no hay ambigüedad de email ni estado pendiente.
- El input de email queda como **ruta secundaria** ("Invitar por correo") para quien aún no tiene cuenta.

### 2. Normalización de email

- Nueva utilidad `normalizeEmail(email)` en `src/app/firebase/auth.ts`: lowercase + quitar puntos de la parte local en dominios `gmail.com` (+ `googlemail.com`). Código y tests en inglés; sin dependencias nuevas.
- `findUidByEmail` consulta primero el email tal cual (lowercase/trim, como hoy) y, si no hay match, reintenta con `normalizeEmail`. Dado que Firestore no permite query con transformación, el reintento consulta por el email normalizado **almacenado**: `ensureUserDoc` escribe (y backfill en login si falta) un campo `emailNormalized` en `users/{uid}`; el reintento hace `where("emailNormalized", "==", normalizeEmail(email))`. Coste: +1 lectura solo en el caso sin match — dentro del free tier.
- `inviteMember` en `StoreProvider.tsx` usa la misma normalización antes de guardar en `pendingInvites`.

### 3. Reconciliación en login (regla por-email)

Nuevo paso `reconcilePendingInvites(user)` que corre tras `ensureUserDoc` en cada inicio de sesión (los tres entry points: email, Google, email-link), y también al montar `AuthProvider` si ya había sesión:

1. `query(collection(db,"stores"), where("pendingInvites","array-contains", normalizeEmail(user.email)))` — regla nueva (ver abajo) permite listar exactamente esas tiendas.
2. Para cada tienda: `writeBatch` con los mismos dos writes del chokepoint — `stores/{id}` y `adminStores/{id}` (`projectAdminStore`) — agregando `user.uid` a `memberUids` y quitando el email de `pendingInvites`.
3. Si el batch falla (p. ej. la tienda cambió mientras tanto), se reintenta una vez y se deja pasar en silencio — el próximo login reconcilia de nuevo (idempotente).

**Cambio de reglas (`firestore.rules`)**, mínimo y auditado en `npm run test:rules`:

- `stores.list`: añadir `|| (isSignedIn() && resource.data.pendingInvites.hasAny([verifiedEmail()]))` — el invitado puede descubrir solo la tienda que lo nombra **a él** (email verificado del token JWT, no del body: reusa `verifiedEmail()` ya definido en `firestore.rules:42`).
- `stores.update` / `adminStores.update`: rama invitee — permitida solo si `resource.data.pendingInvites.hasAny([verifiedEmail()])` Y el diff toca únicamente `memberUids` (agregando exactamente `request.auth.uid`) y `pendingInvites` (quitando exactamente `verifiedEmail()`). Se mantiene la rama `isOwner` intacta; la rama invitee no puede tocar `ownerUid` ni ningún otro campo.
- Sin colección nueva (decisión PO): `pendingInvites` es la única fuente del estado pendiente.

### 4. Invariante de doble plano

- Toda mutación de membresía (invitar por selector, invitar por email, reconciliar, `removeMember` en `StoreProvider.tsx:321-328`, `transferStoreOwnership` en `:329`) pasa por el chokepoint `saveEntity("stores", ...)` o por una `writeBatch` idéntica de dos documentos. Ningún escritor toca un solo plano.
- Test unitario: cada mutación produce writes que incluyen ambos documentos (se afirma sobre el batch, no sobre un plano).

### 5. Mensaje del popup de Google

`signInWithGoogle` detecta `auth/unauthorized-domain` y muestra mensaje en español: "Este dominio no está autorizado para entrar con Google. Pide a la administración que lo agregue en Firebase Console → Authentication → Settings → Authorized domains." No es un fix de código (el dominio se autoriza en consola); es no dejar el error crudo.

## Alcance (out)

- Roles por miembro (congelado por el PO).
- Emails transaccionales reales más allá del email-link existente (`sendInviteLink`, `auth.ts:107-115`).
- Eliminar invitaciones/expiración (YAGNI; una invitación pendiente no cuesta nada).
- Migración masiva de datos (la reconciliación es perezosa en login). Coordinación con `migrate-adminstores` si ambas se entregan: esa spec reconcilia los planos entre sí; esta reconcilia invitaciones; no se pisan (campos distintos).

## Plan de pruebas

- **Unit (vitest):** `normalizeEmail` (casos: Gmail con puntos, mayúsculas, no-Gmail con puntos que SÍ importan); `findUidByEmail` con fallback a `emailNormalized`; `inviteMember` agrega uid directo cuando hay cuenta; `reconcilePendingInvites` produce batch de 2 docs con memberUids+uid y pendingInvites−email, idempotente.
- **Rules (`npm run test:rules`):** invitado lista solo su tienda; invitee-update aceptado solo con el diff exacto; intento de escalar ownerUid o tocar otro campo rechazado; owner-path sin regresión.
- **E2E (emulador, `npm run e2e:firebase`):** A invita a B (email) → B entra con Google → B ve la tienda de A en el selector → en ajustes de A la invitación ya no aparece en pendientes.

## previewChecks

La implementación debe agregar `data-testid="member-invite-select"` al selector de usuarios, `data-testid="pending-invites-list"` a la lista de pendientes y `data-testid="store-settings-sheet"` a la hoja, o los checks fallan.

```json
[
  {
    "name": "Selector de usuarios en hoja de miembros",
    "path": "/",
    "steps": "Abrir 'Cambiar tienda' → engrane de la tienda → hoja de ajustes",
    "checks": [
      { "type": "visible", "selector": "[data-testid=\"store-settings-sheet\"]" },
      { "type": "text", "selector": "[data-testid=\"store-settings-sheet\"]", "text": "Agregar miembro existente" },
      {
        "type": "interactive",
        "description": "Al abrir [data-testid=\"member-invite-select\"] lista usuarios existentes (emails de la colección users) y elegir uno agrega su email a la lista de miembros sin pasar por pendientes"
      }
    ]
  },
  {
    "name": "Invitación pendiente visible y reconciliable",
    "path": "/",
    "steps": "Hoja de ajustes → invitar por correo un email sin cuenta",
    "checks": [
      { "type": "visible", "selector": "[data-testid=\"pending-invites-list\"]" },
      {
        "type": "interactive",
        "description": "Con una segunda cuenta (emulador) cuyo email coincide con la invitación: al iniciar sesión ve la tienda en el selector y [data-testid=\"pending-invites-list\"] ya no contiene el email"
      }
    ]
  }
]
```

## Coste estimado (free tier)

Por login con invitaciones pendientes: 1 query `stores` (con `array-contains`, indexada) + 2 writes por tienda reconciliada. Backfill `emailNormalized`: 1 write por usuario, una sola vez. Muy por debajo de 20K writes/día.
