---
Delivery-ID: persist-entity-error-handling
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/persist-entity-error-handling-design.md
---

# Manejo de errores en persistEntity (fire-and-forget sin .catch)

## Problema

`persistEntity` en `StoreProvider.tsx:229-232` retorna la Promise de `saveEntity` sin manejar errores. Cuando Firestore rechaza una escritura (ej. valores `undefined` anidados, reglas de seguridad, quota exceeded), la promesa se rechaza silenciosamente y:

1. La UI muestra un toast de éxito (ej. `toast.success("Compra registrada: ...")` en `PurchaseForm.tsx:314`) **aunque la escritura falló**.
2. El usuario cree que la operación guardó, pero los datos nunca se escribieron en Firestore.
3. El error aparece solo en consola como un "unhandled promise rejection", sin feedback al usuario.

**Causa raíz verificada en código:**
- `StoreProvider.tsx:229-232`: `persistEntity` retorna `saveEntity(user, name, entity)` sin `.catch()`.
- Llamadas típicas: `await persistEntity("stores", store)` (línea 244, 262, 347), `await persistEntity("products", product)` (línea 397).
- El patrón `void persistEntity(...).catch(() => {})` SÍ existe en algunos lugares (líneas 343, 358, 370), pero **no en la mayoría**.

**Caso real documentado:** Fer (Olivia) reportó que tras una compra la app mostró "Compra registrada" pero el producto no apareció actualizado — resultado de un rechazo de Firestore no visible.

**Líneas verificadas (rama main, sin drift):**
- `persistEntity`: `src/app/StoreProvider.tsx:229-232`.
- Callers con toast implícito / éxito: `addStore:244`, `updateStore:262`,
  `transferStoreOwnership:304/312/322`, `upsertProduct:347-349`.
- `PurchaseForm.submit`: `src/features/inventory/PurchaseForm.tsx:90-107`
  (el `for` hace `await upsertProduct`; la línea 106 `upsertPurchase` es sin
  `await`; el toast de éxito está en la 107).
- Callers con `.catch(() => {})` deliberado (NO tocar): `StoreProvider.tsx`
  líneas 205, 246, 269, 273, 280-291, 304, 312, 313, 322, 339, 370-377.

## Causa raíz (verificada en código)

1. **`saveEntity` sí lanza errores** — `firestoreData.ts:235-263` tiene varios puntos de fallo:
   - `batch.commit()` (línea 258) para stores
   - `setDoc()` (línea 262) para otras entidades
   - `stripUndefined()` (línea 247) no previene todos los rechazos (ej. reglas de seguridad, quota, red)

2. **`persistEntity` no propaga el error** — `StoreProvider.tsx:229-232`:
   ```typescript
   function persistEntity(...): Promise<void> {
     if (!cloud || !user || fromCloud.current) return Promise.resolve();
     return saveEntity(user, name, entity); // ← sin .catch()
   }
   ```

3. **Los callers asumen éxito** — `PurchaseForm.tsx:314`:
   ```typescript
   upsertPurchase({ ...draft, subtotal, updatedAt: nowIso() });
   toast.success(`Compra registrada: ${formatMoney(draft.totalConfirmed || subtotal)}`);
   ```
   Si `upsertPurchase` falla, el toast de éxito miente.

## Objetivo

Todo write a Firestore vía `persistEntity` debe:

1. **Mostrar un error visible al usuario** cuando la escritura falla (toast de error con mensaje claro).
2. **Nunca mostrar éxito falso** — el toast de éxito solo aparece si `persistEntity` resolvió.
3. **Escribir el error en consola** para debugging (con contexto útil: entidad, error, tienda).

## Alcance (in)

**Solo `persistEntity` en `StoreProvider.tsx` — un cambio en un solo punto.**

- Modificar `persistEntity` (líneas 229-232) para agregar `.catch()` con:
  - `console.error()` con contexto
  - Propagar el error para que el caller pueda manejarlo

- Ajustar los callers principales que muestran success toast hoy:
  - `addStore` (línea 244) — "Tienda creada" → manejar error
  - `updateStore` (línea 262) — "Tienda actualizada" → manejar error  
  - `transferStoreOwnership` (línea 347) — "Tienda transferida" → manejar error
  - `upsertProduct` (línea 397) → el success toast es implícito (no hay toast explícito, pero el error debe aparecer)

- **No tocar callers con `.catch(() => {})` existente** — ya son fire-and-forget deliberado (líneas 343, 358, 370).

## Fuera de alcance (out)

- **No cambiar `deleteEntity`** — ya tiene `.catch(() => {})` en todos sus callers (línea 274, 283-290).
- **No cambiar funciones de proyección pública** — `projectPublicForStore`, `upsertPublicProduct`, etc., que ya usan `.catch(() => {})` (líneas 246, 269, 273).
- **No cambiar la lógica de `saveEntity`** — solo el manejo de errores en `persistEntity`.
- **No añadir retry automático** — YAGNI: un error de Firestore es probablemente transitorio o requiere acción humana (auth, quota); reintentar sin criterio puede empeorar.
- **No cambiar el modelo de datos** — solo la capa de presentación de errores.

## Diseño

### Cambio en `persistEntity`

```typescript
// ANTES (StoreProvider.tsx:229-232)
function persistEntity(name: CollectionName, entity: { id: string } & Record<string, unknown>): Promise<void> {
  if (!cloud || !user || fromCloud.current) return Promise.resolve();
  return saveEntity(user, name, entity);
}

// DESPUÉS
function persistEntity(name: CollectionName, entity: { id: string } & Record<string, unknown>): Promise<void> {
  if (!cloud || !user || fromCloud.current) return Promise.resolve();
  return saveEntity(user, name, entity).catch((error) => {
    console.error(`[Firestore] Error persisting ${name} (${entity.id}):`, error);
    throw error; // re-lanzar para que el caller pueda manejarlo
  });
}
```

**Por qué `.catch()` + `throw`:**
- El `console.error` es para debugging (visible en DevTools).
- El `throw` propaga el error al caller — quien decidió si mostrar toast o no.

### Ajuste en callers con success toast

**Patrón:** todos los callers que hoy muestran éxito deben envolver la llamada en `try/catch` y mostrar un error toast si falla.

**Ejemplo genérico:**
```typescript
// ANTES
await persistEntity("stores", store);
toast.success("Tienda creada");

// DESPUÉS
try {
  await persistEntity("stores", store);
  toast.success("Tienda creada");
} catch (error) {
  toast.error("No se pudo guardar la tienda. Revisa tu conexión.");
}
```

**Callers concretos a ajustar (4 total):**

1. **`addStore` (línea 244)**
   - Toast actual: ninguno (el éxito es implícito al volver a la pantalla de tiendas)
   - **Ajuste:** envolver `await persistEntity("stores", storeWithMembership(store, user))` en try/catch
   - Error toast: "No se pudo crear la tienda. Intenta de nuevo."

2. **`updateStore` (línea 262)**
   - Toast actual: ninguno
   - **Ajuste:** envolver `await persistEntity("stores", store)` en try/catch
   - Error toast: "No se pudo actualizar la tienda. Intenta de nuevo."

3. **`transferStoreOwnership` (línea 347)**
   - Toast actual: ninguno
   - **Ajuste:** envolver `await persistEntity("stores", updated)` en try/catch
   - Error toast: "No se pudo transferir la tienda. Intenta de nuevo."

4. **`upsertProduct` implícito en `PurchaseForm.submit` (línea 313)**
   - Toast actual de éxito: `toast.success("Compra registrada: ...")` (línea 314)
   - **Ajuste crítico:** envolver **todo el bloque de escrituras** (líneas 291-314) en try/catch
   - Si algo falla (producto o compra), NO mostrar el toast de éxito
   - Error toast: "No se pudo registrar la compra. Revisa tu conexión o intenta de nuevo."

**Mensaje de error estándar:** "No se pudo guardar. Revisa tu conexión o intenta de nuevo."

### Mensajes en español (México), lenguaje simple

- "No se pudo crear la tienda. Intenta de nuevo."
- "No se pudo actualizar la tienda. Intenta de nuevo."
- "No se pudo transferir la tienda. Intenta de nuevo."
- "No se pudo registrar la compra. Revisa tu conexión o intenta de nuevo."

## Criterios de aceptación

1. **`persistEntity` tiene `.catch()` con `console.error` + `throw`**
   - Verificar en `StoreProvider.tsx:229-232` que el `.catch()` existe
   - Verificar que `console.error` incluye nombre de colección + id de entidad

2. **Los 4 callers principales tienen `try/catch`**
   - `addStore` (línea ~244)
   - `updateStore` (línea ~262)
   - `transferStoreOwnership` (línea ~347)
   - `PurchaseForm.submit` (líneas ~291-314)

3. **El toast de éxito NO aparece si falla la escritura**
   - Simular un error de Firestore (ej. desconectar red, quota exceeded)
   - Verificar que el toast de éxito no se muestra
   - Verificar que el toast de error sí se muestra

4. **El error se ve en consola**
   - Verificar que `console.error` aparece con el mensaje correcto

5. **Los callers con `.catch(() => {})` existente NO cambian**
   - Líneas 343, 358, 370 deben seguir igual

## previewChecks

Ninguno. Este cambio es a la capa de manejo de errores, no a una pantalla nueva;
un previewCheck de browser no aplica. La validación es el gate estándar
(`npm run typecheck && npm run test && npm run build`).

**Deuda de test (registrada):** un test e2e con el Firebase Emulator que fuerce
un rechazo en `upsertPurchase`/`upsertProduct` y afirme el toast de error (y la
ausencia del de éxito) quedó pendiente — el test de UI aislado requería un
fixture completo de `Purchase`/`Store`/`Product` cuyo costo superaba el valor
inmediato. El contrato nuevo (`persistEntity` rechaza, `upsertPurchase` async)
está cubierto por typecheck + la suite existente. La lógica del try/catch en
`PurchaseForm.submit` es trivialmente correcta de leer.

## Riesgos

- **Riesgo bajo:** el cambio es acotado a un solo punto (`persistEntity`) + 4 callers.
- **Riesgo de regresión:** los callers con `.catch(() => {})` existente NO deben cambiar (líneas 343, 358, 370).
- **Riesgo de UX:** un toast de error genérico ("No se pudo guardar") no da mucha información, pero es mejor que un falso éxito. Ponytail: futuros refinamientos pueden distinguir entre "sin red", "quota exceeded", "permiso denegado", etc.

## Dependencias

- **Ninguna.** Este cambio es independiente de otros deliveries.
