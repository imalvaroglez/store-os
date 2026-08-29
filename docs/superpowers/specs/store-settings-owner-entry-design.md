# Acceso del owner a Administrar tienda

## Problema

La dueña de una tienda no tiene forma self-serve de editar el `whatsappPhone`
de su negocio: el botón ⚙ "Administrar" del selector de tiendas
(`StorePickerScreen.tsx:43`) solo se renderiza para `user.role === "super_admin"`
(rol de plataforma), y la dueña es `member` con `ownerUid === user.uid`.

El campo ya existe en `StoreSettingsScreen` y las reglas Firestore ya permiten
al owner escribir su store doc (`isOwner`) — el bloqueo es 100% de UI, fix de
1 línea. Sin este fix no existe camino para poner el número real de WhatsApp
ni en preview ni en producción (contexto: PR #63).

## Objetivo

El ⚙ de cada tienda en "¿Quién opera hoy?" se muestra a:

- `super_admin` (comportamiento actual, sin cambios), y
- la dueña de esa tienda (`s.ownerUid === user?.uid`).

## Alcance (in)

- Gate del ⚙ en `StorePickerScreen.tsx`: `user?.role === "super_admin" || s.ownerUid === user?.uid`.
- Tests UI (patrón `App.test.tsx`, `useAuth` mockeado por módulo): dueña ve ⚙,
  member no-dueña no lo ve, super_admin lo ve en todas (regresión), sin sesión
  (modo demo) no hay ⚙.

## Alcance (out)

- Roles granulares por miembro (backlog congelado).
- Cambios a reglas Firestore, `StoreSettingsScreen` o al plano `adminStores`.
- Que un member NO-dueña administre (sigue sin ⚙ — su `uid` no coincide).

## Criterios de aceptación

1. Dueña (`member`, `ownerUid === uid`) ve el ⚙ de su tienda y puede abrir
   "Administrar tienda" para editar su WhatsApp.
2. Member de otra tienda no ve ⚙ (aislamiento intacto).
3. `super_admin` ve ⚙ en todas las tiendas (regresión cubierta).
4. `npm run typecheck && npm run test && npm run build` verdes.

## Seguridad

- Las reglas Firestore ya restringen la escritura del store doc al owner
  (`isOwner`) y a `super_admin`; el ⚙ solo expone UI que el backend ya
  autoriza. Sin cambios de reglas, sin costo, sin datos nuevos expuestos.
