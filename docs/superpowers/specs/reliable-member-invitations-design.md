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

Que invitar a alguien a operar una tienda funcione de punta a punta sin intervención manual: **buscar una cuenta por correo exacto y, si no existe, guardar una invitación pendiente para ese correo**; al iniciar sesión —con email o Google— la persona ve la tienda en el selector "¿Quién opera hoy?" y la invitación desaparece de "pendientes". Toda la cadena exige **correo verificado** (claim `email_verified` del token).

## Alcance (in)

### 1. Invitar por búsqueda exacta de correo (sin enumeración)

En `StoreSettingsScreen` (hoja de miembros), el flujo principal deja de ser email a ciegas:

- Un campo "Buscar por correo" consulta por email exacto (tal cual y luego canonicalizado, §2). La respuesta devuelve **una única cuenta mínima** (`uid`, email, nombre) — nunca una lista del directorio — y **sólo si el perfil tiene `emailVerified == true`**; perfiles sin verificar no aparecen (se completan al primer login verificado, §2). Con la cuenta visible, la dueña confirma y se agrega su **uid** directamente a `memberUids` vía `updateStore` + `persistEntity("stores", ...)`; ya existe la cuenta, no hay ambigüedad ni estado pendiente.
- Si la búsqueda no devuelve nada, se ofrece invitar por correo (ruta secundaria): el email canonicalizado cae a `pendingInvites` como hoy.
- **Nota de límite:** esto elimina la enumeración de usuarios desde la UI, pero NO corrige la lectura amplia preexistente de `users` que permiten las reglas actuales (cualquier miembro autenticado puede leer la colección). Endurecer esa regla es otra entrega, no esta; se deja constancia para el backlog.

### 2. Normalización de email (compartida TypeScript + Rules)

- Nueva utilidad `normalizeEmail(email)` en `src/app/firebase/auth.ts`: lowercase + quitar puntos de la parte local en dominios `gmail.com`/`googlemail.com` (y tratar `googlemail.com` ≡ `gmail.com`). Código y tests en inglés; sin dependencias nuevas.
- **La misma normalización vive en las dos orillas.** Firestore Rules soporta `lower()` y `replace()` de forma nativa sobre strings (`rules.String`), así que las reglas comparan contra el email canonicalizado del token — no el crudo: donde hoy se usa `verifiedEmail()`, se compara `canonicalEmail()` (expresión en reglas equivalente a `normalizeEmail`: lower + replace de puntos en la parte local de gmail/googlemail). TS y Rules se mantienen deliberadamente idénticas; un test de reglas cubre Gmail con puntos y mayúsculas para evitar deriva.
- `findUidByEmail` consulta primero el email tal cual (lowercase/trim, como hoy) y, si no hay match, reintenta con `normalizeEmail`. **Ambos intentos filtran `emailVerified == true` en la query** (un perfil sin verificar jamás es candidato). Dado que Firestore no permite query con transformación, el reintento consulta por el email normalizado **almacenado**: `ensureUserDoc` escribe (y backfill en login verificado si falta) un campo `emailNormalized` en `users/{uid}`; el reintento hace `where("emailNormalized", "==", normalizeEmail(email))` + `where("emailVerified", "==", true)`.
- `inviteMember` en `StoreProvider.tsx` usa la misma normalización antes de guardar en `pendingInvites`.
- **Correo verificado como prerrequisito, guard CENTRALIZADO.** El token incluye `email_verified`; comparar sólo el email del token no demuestra propiedad del correo. El guard vive **una sola vez, dentro de `ensureUserDoc`** (`src/app/firebase/auth.ts:36`) — no repetido en los entry points (repetirlo en cuatro lugares invite a deriva de seguridad): si `user.emailVerified` es falso, `ensureUserDoc` retorna sin crear/actualizar `users/{uid}` y sin habilitar nada; la reconciliación se invoca **sólo tras un `ensureUserDoc` exitoso**, y el panel privado exige perfil. Los cuatro entry points (email, Google, email-link, montaje de `AuthProvider` con sesión previa) simplemente llaman a `ensureUserDoc`. En email/password: tras registrarse se envía verificación (`sendEmailVerification`); al siguiente login verificado, `ensureUserDoc` crea o completa el perfil (incluye `emailVerified: true` y el backfill de `emailNormalized` — perfiles legacy se completan entonces). Google y email-link entregan correo ya verificado. Pruebas: unitaria del guard en `ensureUserDoc` + **una prueba por entry point** afirmando que sin verificación no progresa (delega en el guard, sin duplicarlo).
- **Backfill de invitaciones legacy:** cuando la dueña carga la tienda (hoja de miembros / `StoreProvider` al seleccionar tienda), las entradas de `pendingInvites` se normalizan in-place (una sola escritura batch de ambos planos, solo si algo cambió). Sin esto, las invitaciones guardadas antes de esta entrega nunca matchean la reconciliación normalizada.

### 3. Reconciliación en login (regla por-email)

Nuevo paso `reconcilePendingInvites(user)` que corre tras `ensureUserDoc` en cada inicio de sesión **con correo verificado** (los cuatro entry points: email, Google, email-link, y montaje de `AuthProvider` con sesión previa — el guard de §2 aplica primero en todos):

1. `query(collection(db,"stores"), where("pendingInvites","array-contains", normalizeEmail(user.email)))` — regla nueva (ver abajo) permite listar exactamente esas tiendas.
2. Para cada tienda: `writeBatch` con los mismos dos writes del chokepoint — `stores/{id}` y `adminStores/{id}` (`projectAdminStore`) — agregando `user.uid` a `memberUids` y quitando el email de `pendingInvites`.
3. Si el batch falla (p. ej. la tienda cambió mientras tanto), se reintenta una vez y se deja pasar en silencio — el próximo login reconcilia de nuevo (idempotente).

**Cambio de reglas (`firestore.rules`)**, mínimo y auditado en `npm run test:rules`:

- **`hasVerifiedEmail()`**: nueva función auxiliar — email presente en el token y `request.auth.token.email_verified == true`. `canonicalEmail()` (canonicalización con `lower()`/`replace()` sobre `verifiedEmail()`, ya definido en `firestore.rules:42`) **sólo se usa después de esa comprobación**.

- **Anti-spoofing + verificación en `users` (crítico).** Hoy `users.create`/`users.update` permiten al propio usuario fijar `email`/`emailNormalized` arbitrarios — con la búsqueda por email eso permitiría suplantar a cualquiera, y un correo no verificado permitiría apropiarse de una invitación. Reglas:
  - `users.create` y **self-update** exigen `hasVerifiedEmail()` Y que el documento deje `email == verifiedEmail()`, `emailNormalized == canonicalEmail()` y `emailVerified == true` (nunca del body).
  - **Update administrativo** (`super_admin` editando a un tercero): se permiten los cambios actuales (p. ej. `role`), pero `email`, `emailNormalized` y `emailVerified` son **inmutables** en ese path — la comparación contra el token del admin no aplicaría y no debe bloquearlo.
  - Pruebas: spoofing rechazado en create y self-update (email ajeno, `emailNormalized` inconsistente, `emailVerified` falso); update admin cross-user puede cambiar `role` sin alterar identidad; token sin `email_verified` no pasa.

- `stores.list`: añadir `|| (hasVerifiedEmail() && resource.data.pendingInvites.hasAny([canonicalEmail()]))` — el invitado puede descubrir solo la tienda que lo nombra **a él**, con correo verificado.
- `stores.update` / `adminStores.update`: rama invitee — permitida solo si `hasVerifiedEmail()` Y `resource.data.pendingInvites.hasAny([canonicalEmail()])` Y el diff toca únicamente `memberUids` (agregando exactamente `request.auth.uid`) y `pendingInvites` (quitando exactamente `canonicalEmail()`). Se mantiene la rama `isOwner` intacta; la rama invitee no puede tocar `ownerUid` ni ningún otro campo.
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
- **Rules (`npm run test:rules`)** — sólo casos negativos: spoofing de `email`/`emailNormalized`/`emailVerified` rechazado en `users.create` y self-update; token sin `email_verified` no crea perfil ni pasa las ramas invitee; invitee-update aceptado solo con el diff exacto; intento de escalar ownerUid o tocar otro campo rechazado; owner-path sin regresión; update admin cross-user cambia `role` sin alterar identidad.
- **Integración (emulador):** casos positivos — Google, email-link y password verificado crean perfil, habilitan panel y reconcilian; el flujo NO verificado no progresa en ninguno de los cuatro entry points; `findUidByEmail` (ambos intentos) no devuelve perfiles sin verificar.
- **Unit (vitest):** guard centralizado en `ensureUserDoc` (una prueba por entry point + la del propio guard).
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

**Lecturas:** reconciliación = `max(1, I)` lecturas para I invitaciones encontradas (Firestore factura al menos 1 lectura aunque la query devuelva cero resultados) por login verificado; búsqueda exacta con fallback = 1–2 consultas (≥1 lectura cada una, aun sin resultado). **Lecturas dependientes de reglas:** cada evaluación de `stores.list`/`stores.update`/`adminStores.*` resuelve `isMember`/`isOwner` con un `get`/`exists()` sobre `adminStores` → acote máximo: **≤2 reads extra por intento de write** (uno por plano evaluado) y **+1 read por tienda devuelta en `list`**; incluidas en el contraste contra 50K/día. **Writes:** `2I` por tienda reconciliada; backfill `emailNormalized` (+`emailVerified`) = 1 write por usuario, una sola vez; backfill de `pendingInvites` legacy = 2 writes por tienda normalizada (`stores` + `adminStores`), una sola vez. La verificación de correo usa Firebase Auth (`sendEmailVerification` + claim del token): sin servicio nuevo ni writes. Todo muy por debajo de 50K lecturas y 20K writes/día.
