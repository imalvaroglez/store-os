---
Delivery-ID: remove-client-demo-seed
Delivery-Status: Completed — superseded by docs/ENVIRONMENTS.md
specPath: docs/superpowers/specs/remove-client-demo-seed-design.md
---

# Retirar la siembra automática del cliente

> Esta especificación histórica ya fue implementada. El contrato vigente de
> ambientes está en [`docs/ENVIRONMENTS.md`](../../ENVIRONMENTS.md): no existe
> modo demo ni backend alterno; los datos de desarrollo se publican de forma
> explícita en el proyecto Firebase real `store-os-dev`.

## Problema

El archivo `src/lib/seed.ts` contiene datos de demo (tiendas Olivia, Santi, Joyería con productos, clientes, pedidos) que **ya no corresponden al producto real en producción**. La aplicación ahora está en producción con datos reales; mantener datos demo obsoletos crea confusión y deuda técnica innecesaria.

**Causa raíz verificada en código:**
- `src/lib/seed.ts:buildSeedState()` (líneas 9-385) genera 3 tiendas demo con datos hardcoded
- `src/app/StoreProvider.tsx:134` usa `buildSeedState()` en el action `RESET_DEMO`
- `src/features/stores/StoresScreen.tsx:27-28` ofrece un botón "Cargar datos de ejemplo" que llama `resetDemo()`
- Tests usan `buildSeedState()` como fixture (App.test.tsx, StoreProvider.reducer.test.ts, selectors.test.ts)

**Estado actual del path local:**
- `src/lib/storage.ts:loadState()` **ya no carga el seed automáticamente** — usa `freshState()` que retorna `emptyState()` (líneas 19-21)
- Comentario en storage.ts:9-14 explica que el seed ya no se auto-carga por UX ("Seeing phantom demo stores was confusing operators")
- **Solo el botón manual y tests dependen de `buildSeedState()`**

## Objetivo

Retirar la responsabilidad de generar datos demo del cliente, manteniendo la capacidad de operar en modo local-first sin backend. La decisión de diseño es **reemplazar con un estado inicial vacío pero válido**, no eliminar la funcionalidad `resetDemo()`.

## Alcance (in)

- Cambiar `src/lib/seed.ts:buildSeedState()` para retornar un `AppState` vacío pero válido (no datos demo)
- Actualizar `src/app/StoreProvider.tsx:134` (action `RESET_DEMO`) para usar el nuevo estado vacío
- Mantener el botón "Cargar datos de ejemplo" en `StoresScreen` pero cambiar su semántica
- Actualizar tests que dependen de `buildSeedState()` para crear sus propios fixtures
- Documentar el cambio en comentarios relevantes

## Fuera de alcance (out)

- Modificar `seedCloudIfEmpty()` (ya es no-op, no toca el cliente)
- Eliminar el botón de reset demo (se reutiliza para "limpiar datos locales")
- Cambiar el contrato de `AppState` o el reducer
- Modificar reglas de Firestore o proyecciones públicas

## Diseño

### 1. Nuevo contrato de `buildSeedState()`

**Antes (actual):**
```typescript
// src/lib/seed.ts:9-385
export function buildSeedState(): AppState {
  // Retorna Olivia, Santi, Joyería con productos, clientes, pedidos
}
```

**Después:**
```typescript
// src/lib/seed.ts
export function buildSeedState(): AppState {
  return emptyState(); // Reutiliza la función de storage.ts
}

function emptyState(): AppState {
  return {
    stores: [],
    activeStoreId: null,
    products: [],
    categories: [],
    suppliers: [],
    purchases: [],
    customers: [],
    orders: [],
  };
}
```

**Rationale:** YAGNI — el caso "reset demo" ahora significa "limpiar todo", no "cargar datos de ejemplo". Quien quiera explorar el app puede crear una tienda desde cero, que es el flujo real de producción.

### 2. Botón "Cargar datos de ejemplo"

**Cambio en `StoresScreen.tsx:22-35`:**

```typescript
// Antes
<Button onClick={() => { if (confirm("¿Cargar datos de ejemplo? ...")) { resetDemo(); } }}>
  Cargar datos de ejemplo
</Button>

// Después
<Button onClick={() => { if (confirm("¿Limpiar todos los datos locales? ...")) { resetDemo(); } }}>
  Limpiar datos locales
</Button>
```

El texto debe reflejar la nueva acción: reset = limpiar, no cargar demo.

### 3. Actualización de tests

**Tests afectados (dependen de `buildSeedState()`):**
- `src/app/StoreProvider.reducer.test.ts:13,29-50` — crea un producto de control para tests de stock
- `src/app/App.test.tsx:28,46` — usa seed state para montar el árbol React
- `src/lib/selectors.test.ts` — usa seed para probar selectores

**Estrategia:** Cada test crea su propio fixture mínimo, en lugar de depender de datos demo obsoletos.

**Ejemplo StoreProvider.reducer.test.ts:**
```typescript
// Antes
function stateWithOneInventoryProduct(): { state: AppState; product: Product } {
  const state = buildSeedState(); // Venía con Olivia
  const store = state.stores[0];
  // ...
}

// Después
function stateWithOneInventoryProduct(): { state: AppState; product: Product } {
  const store: Store = {
    id: "test-store",
    name: "Test Store",
    slug: "test-store",
    type: "inventory_tiered",
    whatsappPhone: "5215512345678",
    skuPrefix: "TEST",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  };
  const state: AppState = {
    stores: [store],
    activeStoreId: store.id,
    products: [],
    categories: [],
    suppliers: [],
    purchases: [],
    customers: [],
    orders: [],
  };
  // ... resto de la lógica
}
```

**App.test.tsx:**
```typescript
// Antes
function withState(state: ReturnType<typeof buildSeedState>) {
  // ...
}
const Wrapper = withState(buildSeedState());

// Después
function withState(state: AppState) {
  // ...
}
const testState: AppState = {
  stores: [],
  activeStoreId: null,
  products: [],
  categories: [],
  suppliers: [],
  purchases: [],
  customers: [],
  orders: [],
};
const Wrapper = withState(testState);
```

### 4. Documentación

- Actualizar comentario en `src/lib/seed.ts:3-7` para reflejar que ahora es `emptyState()`
- Actualizar comentario en `src/lib/storage.ts:9-14` para confirmar que no hay seed automático
- Sin cambios en docs/ (ARCHITECTURE.md no menciona el seed específicamente)

## Criterios de aceptación

1. `buildSeedState()` retorna un estado vacío (todos los arrays vacíos, `activeStoreId: null`)
2. `RESET_DEMO` action en StoreProvider usa el nuevo estado vacío
3. Botón en StoresScreen dice "Limpiar datos locales" y resetea a estado vacío
4. Tests modificados pasan sin depender de datos demo
5. `npm run test` pasa completo
6. `npm run typecheck` pasa
7. `npm run build` pasa
8. E2E smoke tests pasan (el flujo "crear primera tienda" debe funcionar desde cero)

## previewChecks

```json
[
  {
    "path": "/",
    "selector": "main",
    "text": "Crea tu primera tienda"
  },
  {
    "path": "/",
    "selector": "button",
    "text": "Limpiar datos locales"
  }
]
```

**Verificación manual:**
1. Abrir app en modo local (sin backend)
2. Verificar que la pantalla muestra "Crea tu primera tienda" (no tiendas demo)
3. Crear una tienda desde cero y verificar que funciona el flujo completo
4. Click en "Limpiar datos locales" y verificar que regresa al estado vacío

## Riesgos

- **Bajo:** Tests que asumen datos específicos de Olivia/Santi pueden fallar si no se actualizan todos. **Mitigación:** ejecutar `npm run test` completo y actualizar cada test afectado.
- **Bajo:** Flujo "crear primera tienda" podría tener bugs si nadie lo ha probado desde cero recientemente. **Mitigación:** E2E smoke test cubre este camino.
- **Cero:** No hay impacto en cloud/producción (Firestore no usa este código).

## Dependencias

Ninguna. Este cambio es independiente de otros items de la cola.

## Notas de revisión (2026-08-17, ajustes menores incorporados)

1. `scripts/seed-dev.cjs:17-19` documenta un contrato espejo con `buildSeedState()` (copia Olivia hardcodeada propia). Al retirar el seed del cliente, actualizar ese comentario: `seed-dev.cjs` queda como el único dueño del fixture de Olivia.
2. Simplificación recomendada: en vez de dejar un `buildSeedState()` que devuelve estado vacío, que el action `RESET_DEMO` devuelva `emptyState()` exportado de `src/lib/storage.ts` y **borrar `src/lib/seed.ts` completo** (evita duplicar el `emptyState` privado). El botón en StoresScreen pasa a "Limpiar datos locales".
3. El botón es hoy un no-op silencioso en modo cloud (`StoreProvider.tsx:486` retorna si `cloud`): **ocultarlo en modo cloud** para no dejar un botón muerto.
4. Los tests afectados por `buildSeedState` son más de los citados: además de `StoreProvider.reducer.test.ts:13,29-50`, están las líneas 138, 150 y 163 del mismo archivo, y `App.test.tsx:7,13,28,46` y `selectors.test.ts:11,15,42`.
