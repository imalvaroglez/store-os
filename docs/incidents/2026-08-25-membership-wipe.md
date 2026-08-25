# Incidente: pérdida de acceso de un miembro (memberUids colapsado) — 2026-08-25

**Severidad:** alta (usuario legítimo pierde acceso a su tienda en producción, sin error visible).
**Afectada:** Fer (`oliviaaa.jewerly@gmail.com`, uid `w6FdYsWS…`) en `store_olivia` de **prod**.
**Tercera ocurrencia** de la familia (ver Incidentes previos). Esta vez se encontró la causa raíz.

## Síntoma

Fer, con sesión activa y acceso vigente, pasa a ver la vista de "crear tienda": el selector
no le muestra Olivia. Estado encontrado en Firestore: `memberUids = [owner]` en **ambos**
planos (`stores/store_olivia` y `adminStores/store_olivia`); su uid simplemente no estaba.
`pendingInvites = []`.

## Causa raíz (confirmada por investigación sistemática + verificación adversarial)

`storeWithMembership(store, user)` (antes en `StoreProvider.tsx`) escribía
**incondicionalmente**:

```ts
return { ...store, ownerUid: user.uid, memberUids: [user.uid] };
```

Era correcta para **crear** tienda, pero se usaba también en **dos escrituras de fondo que
corren en el login** de cualquier miembro/owner:

1. **Backfill de normalización de `pendingInvites`** (efecto en `StoreProvider`): si la
   tienda tenía un invite legado no canónico (mayúsculas, espacios, duplicados — p. ej. el
   invite original de Fer), disparaba `saveEntity(user, "stores", storeWithMembership(updated, user))`.
2. **Persist de migración de catálogo** (`migrateCatalog` reescribe tiendas sin `storefront`).

`saveEntity("stores", …)` escribe `stores` y `adminStores` **en el mismo batch** (G-P02), y
`projectAdminStore` copia `memberUids` tal cual: el colapso a `[usuario actual]` se propagaba
a ambos planos de forma atómica y **silenciosa** (`.catch(() => {})`). El backfill, además,
normalizaba el invite que lo disparó — destruyendo la evidencia.

Es decir: **no fue un edit del owner** — fue el propio login del owner con un invite legado
pendiente. Los edits de tienda (`updateStore`) están exonerados: preservan los campos vía
spread.

### Factores agravantes documentados (familia del bug)

- **Plano dual duplicado**: `stores` y `adminStores` llevan copias de `memberUids`; las reglas
  leen solo `adminStores`. Cualquier drift entre planos = miembro invisible.
- **Snapshot completo de arrays**: `saveEntity` usa `setDoc(merge:true)` — los arrays se
  reemplazan enteros. Un cliente con estado rancio puede revertir una membresía agregada
  desde otro dispositivo. `removeMember` comparte este riesgo (no usa `arrayRemove`).
- Escrituras de fondo fire-and-forget con catch silencioso.

## Fix (commit en `fix/membership-wipe`)

1. **`src/lib/membership.ts`** (nuevo): `storeWithMembership` con semántica **preservadora** —
   defaults solo cuando la tienda no tiene membresía (creación); si ya tiene, preserva y a lo
   sumo agrega al usuario actual. `invitesNeedBackfill` extrae la decisión del backfill
   (testeable). Unit tests en `membership.test.ts`.
2. **Backfill** en `StoreProvider` usa las funciones nuevas y **loguea** errores (adiós al
   catch silencioso).
3. **`projectAdminStore`** endurecido: `memberUids ?? []` (un `undefined` reventaba el batch
   completo).
4. **Test e2e de regresión** (`member-invite.spec.ts`): siembra un invite legado + un segundo
   miembro en ambos planos, re-login del owner, y afirma que la membresía queda intacta en
   ambos planos. **Verificado que falla con el helper viejo y pasa con el fix.**

## Qué queda abierto (candidatos a ciclo de deuda)

- `removeMember`/`updateStore` escriben el array completo desde memoria (riesgo de revertir
  membresías concurrentes). Usar `arrayUnion`/`arrayRemove` como `reconcilePendingInvites`.
- El script `migrate-adminstores` (spec aprobada, no implementada) para reparar drift entre
  planos en prod.
- No hay detección/alerta: una escritura destructiva de membresía es invisible hasta que
  alguien pierde acceso. Considerar un chequeo barato al cargar (ownerUid sin owner en
  memberUids, etc.).

## Incidentes previos de la familia

- Mar (miembro de Olivia en prod): invite por email nunca reconciliado + drift de planos;
  arreglada a mano escribiendo su UID.
- Deriva de uid de Olivia en **dev** (2026-08-13): arreglada a mano.
- Este (2026-08-25, prod): causa raíz encontrada y corregida.

## Réplicas y artefactos

- Investigación: 3 lectores en paralelo (escritores de `memberUids`, arqueología git,
  specs/reglas) + verificación adversarial independiente — veredicto CONFIRMED.
- Reproducción del bug en emulador con el helper viejo: el test e2e de regresión falla
  exactamente con la firma del incidente (`memberUids = [owner]` en ambos planos).
