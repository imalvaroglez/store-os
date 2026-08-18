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

Decisiones cerradas del PO (`docs/BACKLOG.md:50-54` y `143-162`, revisadas 2026-08-18): reusar `pendingInvites` + regla por-email (ponytail, sin colección nueva); la UI invita buscando por correo exacto con confirmación de una sola cuenta (sin directorio completo); la normalización de email va en esta misma entrega.

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

### 1. Invitar por búsqueda exacta de correo (sin enumeración)

En `StoreSettingsScreen` (hoja de miembros), el flujo principal deja de ser email a ciegas:

- Un campo "Buscar por correo" consulta por email exacto (tal cual y luego canonicalizado, §2). La respuesta devuelve **una única cuenta mínima** (`uid`, email, nombre) — nunca una lista del directorio. Con la cuenta visible, la dueña confirma y se agrega su **uid** directamente a `memberUids` vía `updateStore` + `persistEntity("stores", ...)`; ya existe la cuenta, no hay ambigüedad ni estado pendiente.
- Si la búsqueda no devuelve nada, se ofrece invitar por correo (ruta secundaria): el email canonicalizado cae a `pendingInvites` como hoy.
- **Nota de límite:** esto elimina la enumeración de usuarios desde la UI, pero NO corrige la lectura amplia preexistente de `users` que permiten las reglas actuales (cualquier miembro autenticado puede leer la colección). Endurecer esa regla es otra entrega, no esta; se deja constancia para el backlog.

### 2. Normalización de email (compartida TypeScript + Rules)

- Nueva utilidad `normalizeEmail(email)` en `src/app/firebase/auth.ts`: lowercase + quitar puntos de la parte local en dominios `gmail.com`/`googlemail.com` (y tratar `googlemail.com` ≡ `gmail.com`). Código y tests en inglés; sin dependencias nuevas.
- **La misma normalización vive en las dos orillas.** Firestore Rules soporta `lower()` y `replace()` de forma nativa sobre strings (`rules.String`), así que las reglas comparan contra el email canonicalizado del token — no el crudo: donde hoy se usa `verifiedEmail()`, se compara `canonicalEmail()` (expresión en reglas equivalente a `normalizeEmail`: lower + replace de puntos en la parte local de gmail/googlemail). TS y Rules se mantienen deliberadamente idénticas; un test de reglas cubre Gmail con puntos y mayúsculas para evitar deriva.
- `findUidByEmail` consulta primero el email tal cual (lowercase/trim, como hoy) y, si no hay match, reintenta con `normalizeEmail`. Dado que Firestore no permite query con transformación, el reintento consulta por el email normalizado **almacenado**: `ensureUserDoc` escribe (y backfill en login si falta) un campo `emailNormalized` en `users/{uid}`; el reintento hace `where("emailNormalized", "==", normalizeEmail(email))`. Coste: +1 lectura solo en el caso sin match — dentro del free tier.
- `inviteMember` en `StoreProvider.tsx` usa la misma normalización antes de guardar en `pendingInvites`.
- **Backfill de invitaciones legacy:** cuando la dueña carga la tienda (hoja de miembros / `StoreProvider` al seleccionar tienda), las entradas de `pendingInvites` se normalizan in-place (una sola escritura batch de ambos planos, solo si algo cambió). Sin esto, las invitaciones guardadas antes de esta entrega nunca matchean la reconciliación normalizada.

### 3. Reconciliación en login (regla por-email)

Nuevo paso `reconcilePendingInvites(user)` que corre tras `ensureUserDoc` en cada inicio de sesión (los tres entry points: email, Google, email-link), y también al montar `AuthProvider` si ya había sesión:

1. `query(collection(db,"stores"), where("pendingInvites","array-contains", normalizeEmail(user.email)))` — regla nueva (ver abajo) permite listar exactamente esas tiendas.
2. Para cada tienda: `writeBatch` con los mismos dos writes del chokepoint — `stores/{id}` y `adminStores/{id}` (`projectAdminStore`) — agregando `user.uid` a `memberUids` y quitando el email de `pendingInvites`.
3. Si el batch falla (p. ej. la tienda cambió mientras tanto), se reintenta una vez y se deja pasar en silencio — el próximo login reconcilia de nuevo (idempotente).

**Cambio de reglas (`firestore.rules`)**, mínimo y auditado en `npm run test:rules`:

- **Anti-spoofing en `users` (crítico).** Hoy `users.create`/`users.update` permiten al propio usuario fijar `email`/`emailNormalized` arbitrarios — con la búsqueda por email eso permitiría suplantar a cualquiera. Ambas reglas pasan a exigir que el documento deje `email == verifiedEmail()` y `emailNormalized == canonicalEmail()` (email verificado/canonicalizado del token, nunca del body). Pruebas de reglas que **rechacen spoofing en create y en update** (email ajeno y emailNormalized inconsistente).

- `stores.list`: añadir `|| (isSignedIn() && resource.data.pendingInvites.hasAny([canonicalEmail()]))` — el invitado puede descubrir solo la tienda que lo nombra **a él** (email verificado del token JWT, canonicalizado en reglas con `lower()`/`replace()`; reusa `verifiedEmail()` ya definido en `firestore.rules:42` como base de `canonicalEmail()`).
- `stores.update` / `adminStores.update`: rama invitee — permitida solo si `resource.data.pendingInvites.hasAny([canonicalEmail()])` Y el diff toca únicamente `memberUids` (agregando exactamente `request.auth.uid`) y `pendingInvites` (quitando exactamente `canonicalEmail()`). Se mantiene la rama `isOwner` intacta; la rama invitee no puede tocar `ownerUid` ni ningún otro campo.
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
- **Rules (`npm run test:rules`):** invitado lista solo su tienda; invitee-update aceptado solo con el diff exacto; intento de escalar ownerUid o tocar otro campo rechazado; owner-path sin regresión; spoofing de `email`/`emailNormalized` rechazado en `users.create` y `users.update`.
- **E2E (emulador, `npm run e2e:firebase`):** A invita a B (email) → B entra con Google → B ve la tienda de A en el selector → en ajustes de A la invitación ya no aparece en pendientes.

## previewChecks

```json
[
  { "path": "/", "selector": "body", "text": "Entrar" }
]
```

(Humo de arranque; el flujo de invitación/reconciliación queda cubierto por el e2e de
emulador del plan de pruebas.)

## Coste estimado (free tier)

Por login con invitaciones pendientes: 1 query `stores` (con `array-contains`, indexada) + 2 writes por tienda reconciliada. Backfill `emailNormalized`: 1 write por usuario, una sola vez. Backfill de `pendingInvites` legacy: 2 writes por tienda normalizada (`stores` + `adminStores`), una sola vez. Muy por debajo de 20K writes/día.
