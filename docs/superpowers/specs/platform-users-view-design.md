---
Delivery-ID: platform-users-view
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/platform-users-view-design.md
---

# Vista de usuarios de la plataforma (solo lectura para super_admin)

## Problema

El super_admin actual no tiene visibilidad de los usuarios registrados en la plataforma. Para la funcionalidad de invitación por selector (elegir un usuario existente en lugar de escribir el email a ciegas), el super_admin necesita ver primero qué usuarios existen. Actualmente no hay ninguna vista que liste la colección `users/{uid}`.

## Causa raíz verificada en código

**Verificado en `firestore.rules` líneas 51-59:** La colección `users/{uid}` ya permite lectura a cualquier usuario autenticado (`allow read: if isSignedIn()`). El super_admin tiene permiso para leer todos los documentos.

**Verificado en `src/app/firebase/auth.ts` líneas 45-46:** Existe un patrón de lectura de la colección completa: `const all = await getDocs(collection(db, "users"));` usado para determinar el primer usuario (bootstrap).

**Verificado en `src/app/firebase/auth.ts` líneas 25-32:** El tipo `AppUser` define `uid`, `email`, `displayName` (opcional), y `role` ("super_admin" | "member"). (Vive ahí, no en `src/types/index.ts`.)

**Verificado en `src/app/AppShell.tsx` líneas 1-175:** No existe actualmente una pantalla de administración de usuarios. El shell actual solo muestra tiendas, catálogo, pedidos, clientes e inventario.

**Verificado en `src/design-system/navItems.ts` líneas 1-46:** Los tabs existentes son: inicio, catálogo (con hijos), pedidos, clientes, inventario. No hay tab de "usuarios".

## Objetivo

Implementar una vista de solo lectura que liste todos los usuarios de la plataforma (`users/{uid}`) accesible únicamente para usuarios con `role === "super_admin"`. Esta vista debe mostrar email, rol, fecha de creación y opcionalmente displayName, sin permitir escrituras (no edición, no creación, no eliminación).

## Alcance (in)

- Nueva pantalla `PlatformUsersScreen` ubicada en `src/features/users/PlatformUsersScreen.tsx`
- Integración en `AppShell` con acceso condicional: solo visible cuando `user.role === "super_admin"`
- Fetch directo de `users/{uid}` usando `getDocs(collection(db, "users"))` (patrón existente en `auth.ts:45`)
- UI tipo lista/tarjetas mostrando: email, displayName (si existe), rol (badge), createdAt (formateado)
- Filtro de búsqueda por email (búsqueda local en el array, no query backend)
- Estado vacío cuando no hay usuarios (aplicable solo si la colección está vacía, lo cual es improbable en producción)
- Loading state mientras se carga la lista
- Navegación: nuevo tab "Usuarios" en el nav principal (solo visible para super_admin)
- Router: ruta `/usuarios` que resuelve a la nueva pantalla
- Preview check: validar que la lista carga y muestra usuarios en Preview

## Fuera de alcance (out)

- Montar la vista fuera de `AppShell` (super_admin sin tienda activa). Resolver el mounting global del shell es un cambio de producto mayor; V1 requiere tienda activa seleccionada.
- **Threading de `userRole`:** `visibleNavItems(storeType, userRole?)` exige pasar el rol desde `AppShell` a `Sidebar`/`BottomNav` y al `CommandPalette` (`AppShell.tsx:70`). Es parte del alcance de implementación, no opcional — sin él el tab aparece inconsistente entre paleta y nav.
- Edición de usuarios (no cambiar roles, no cambiar emails)
- Creación de usuarios (el signup existente maneja esto)
- Eliminación de usuarios
- Invitación desde esta pantalla (la invitación por selector es una feature separada)
- Paginación (se asume <100 usuarios en V1; si crece, se añadirá paginación después)
- Exportación de datos
- Filtros avanzados (búsqueda local por email es suficiente)

## Diseño

### Ubicación y acceso

**Verificado en `src/app/AppShell.tsx` líneas 26-32:** El enum `Tab` debe extenderse para incluir `"usuarios"`.

**Verificado en `src/design-system/navItems.ts` líneas 19-33:** El array `NAV_ITEMS` debe incluir un nuevo entry:

```typescript
{ id: "usuarios", label: "Usuarios", path: "/usuarios" }
```

Este entry solo debe aparecer en `visibleNavItems()` cuando el usuario actual es `super_admin`.

### Componente principal: `PlatformUsersScreen`

Archivo: `src/features/users/PlatformUsersScreen.tsx`

Patrón siguiendo `CustomersScreen.tsx` pero sin escrituras:

```typescript
interface PlatformUser {
  uid: string;
  email: string;
  displayName?: string | null;
  role: "super_admin" | "member";
  createdAt: Timestamp | null; // serverTimestamp() → objeto Timestamp de Firestore, null si el server timestamp aún no resuelve
}

// Estado local para la lista
const [users, setUsers] = useState<PlatformUser[]>([]);
const [loading, setLoading] = useState(true);
const [search, setSearch] = useState("");

// useEffect para cargar usuarios una vez (no es real-time como las tiendas)
useEffect(() => {
  async function loadUsers() {
    const { db } = getFirebase();
    const snap = await getDocs(collection(db, "users"));
    const loaded = snap.docs.map(d => ({
      uid: d.id,
      ...d.data()
    } as PlatformUser));
    setUsers(loaded);
    setLoading(false);
  }
  loadUsers();
}, []);

// Filtro local por email
const filtered = users.filter(u => 
  u.email?.toLowerCase().includes(search.toLowerCase())
);
```

### UI propuesta

**Header:**
- Título: "Usuarios de la plataforma"
- Subtítulo: `${users.length} usuarios` (o `${filtered.length} encontrados` cuando hay búsqueda)
- Campo de búsqueda: `<TextField placeholder="Buscar por email..." value={search} onChange={e => setSearch(e.target.value)} />`

**Lista (tarjetas tipo CustomersScreen):**

Para cada usuario:
- Card con:
  - Nombre principal: `displayName || email` (si no hay displayName, usar email)
  - Secundario: email (si displayName existe) + uid recortado
  - Badge de rol: "super_admin" (tone="primary") o "member" (tone="default")
  - Fecha: `createdAt?.toDate().toLocaleDateString("es-MX") ?? "—"`. **Nunca `new Date(createdAt)`**: es un Timestamp de Firestore (`serverTimestamp()` en `auth.ts:51`), no un string ISO — `new Date(Timestamp)` produce "Fecha inválida".
  - Sin acciones (dropdown, editar, eliminar) — es solo lectura

**Estado vacío:**
`<EmptyState title="No hay usuarios" subtitle="No se encontraron usuarios en la plataforma." icon={<div className="text-6xl">👥</div>} />`

**Loading:**
Spinner o skeleton mientras `loading === true`.

### Integración en AppShell

**Verificado en `src/app/AppShell.tsx` líneas 78-97:** Añadir case en el switch:

```typescript
case "usuarios":
  screen = <PlatformUsersScreen />;
  break;
```

**Modificación de `visibleNavItems` en `src/design-system/navItems.ts`:**

```typescript
export function visibleNavItems(storeType: StoreType, userRole?: "super_admin" | "member") {
  const items = NAV_ITEMS.filter((t) => t.id !== "inventario" || storeType === "inventory_tiered");
  // Solo super_admin ve el tab de usuarios
  if (userRole !== "super_admin") {
    return items.filter(t => t.id !== "usuarios");
  }
  return items;
}
```

### Router

**Verificado en `src/lib/router.ts` líneas 34-37:** El patrón adminMatch ya captura rutas de 1-2 segmentos, así que `/usuarios` resolverá a `{ name: "admin", params: { tab: "usuarios", sub: "" }`.

**Verificado en `src/app/AppShell.tsx` líneas 42-51:** El mapping `TAB_FOR_PATH` necesita incluir:

```typescript
const TAB_FOR_PATH: Record<string, Tab> = {
  "": "inicio",
  "catalogo-admin": "catalogo",
  "pedidos": "pedidos",
  "clientes": "clientes",
  "inventario": "inventario",
  "usuarios": "usuarios", // nuevo
};
```

## Criterios de aceptación

1. **Super_admin con tienda activa ve la lista:** Al loguear como `admin@store.os` **con una tienda activa seleccionada**, el tab "Usuarios" aparece en navegación móvil y desktop.
   - **Caso sin tienda activa (conocido):** `AppShell.tsx:65` devuelve `null` sin `activeStore`, así que un super_admin sin membresía de tienda aterriza en `StorePickerScreen` y no reach esta vista. V1 no lo resuelve (ver "Fuera de alcance"); el workaround es seleccionar cualquier tienda primero.
2. **La lista carga correctamente:** La pantalla muestra todos los usuarios de la colección `users/{uid}` con email, displayName, rol y fecha de creación.
3. **Member no ve el tab:** Un usuario con `role === "member"` NO ve el tab "Usuarios" en ninguna parte de la UI.
4. **Búsqueda local funciona:** El campo de búsqueda filtra la lista por email (case-insensitive) en tiempo real.
5. **Sin escrituras:** No hay botones de editar, crear ni eliminar usuarios en esta pantalla. Es solo lectura.
6. **Estados vacío y loading:** La pantalla muestra loading mientras carga y un empty state si no hay usuarios.
7. **Badge de rol visible:** Cada tarjeta muestra claramente si el usuario es "super_admin" o "member" con un badge.
8. **Preview check válido:** En Preview (Vercel), la pantalla carga y muestra los usuarios de `store-os-dev`.

## previewChecks

Los selectores asumen contract creado por esta entrega: la implementación **debe** agregar `data-testid="user-card"` a cada tarjeta y `aria-label="Usuarios"` al tab, o los checks fallan. No son selectores especulativos.

```json
{
  "name": "Lista de usuarios visible para super_admin",
  "path": "/usuarios",
  "checks": [
    {
      "description": "El tab \"Usuarios\" aparece en navegación móvil (bottom) y desktop (sidebar)",
      "type": "visual",
      "selector": "[aria-label=\"Usuarios\"], nav a[href=\"/usuarios\"]",
      "expected": "visible"
    },
    {
      "description": "La lista de usuarios carga y muestra al menos un usuario (el super_admin actual)",
      "type": "visual",
      "selector": ".card, [data-testid=\"user-card\"]",
      "expected": "at-least-one"
    },
    {
      "description": "Cada tarjeta muestra email, rol (badge) y fecha de creación",
      "type": "visual",
      "selector": ".card",
      "expected": "contains-text: @, super_admin|member, 20"
    },
    {
      "description": "La búsqueda por email filtra la lista",
      "type": "interaction",
      "selector": "input[placeholder*=\"email\" i]",
      "action": "type admin@store.os",
      "expected": "exactly-one"
    }
  ]
}
```

## Riesgos

- **Postura de privacidad preexistente (informada, no regresión):** la regla actual `users: allow read if isSignedIn()` significa que **cualquier miembro de cualquier tienda ya puede leer el email de todos los usuarios** vía SDK. Esta vista no cambia eso, pero el super_admin debe saberlo: la única protección es la puerta de UI. Endurecer la regla (lectura solo super_admin + propio doc) es trabajo futuro; hacerlo aquí rompería el bootstrap de primer usuario.
- **Riesgo bajo:** La colección `users` puede crecer más de 100 usuarios en producción, lo que haría la lista lenta. Si esto ocurre, se necesitará paginación en una iteración futura (fuera del alcance de V1).
- **Riesgo mitigado:** Las reglas de Firestore ya permiten la lectura (`allow read: if isSignedIn()`), así que no hay cambios de seguridad necesarios.
- **Riesgo nulo:** Al ser solo lectura, no hay riesgo de corrupción de datos.

## Dependencias

- **Dependencia de feature:** Esta vista es un prerrequisito para la feature de invitación por selector (elegir usuario existente en lugar de escribir email).
- **Dependencia técnica:** El existente `getDocs(collection(db, "users"))` en `auth.ts` demuestra que el patrón funciona; esta pantalla reutiliza el mismo enfoque.

## Notas de implementación

- **Ponytail:** No usar `onSnapshot` (real-time) para esta pantalla. La lista de usuarios cambia poco y un fetch one-shot es suficiente. Si se necesita real-time en el futuro, se puede añadir.
- **Ponytail:** La búsqueda es local (filter en el array del cliente). Con <100 usuarios esto es instantáneo. No se necesita búsqueda backend con índices compuestos.
- **Timestamp:** `createdAt` en `users/{uid}` ya se establece en `auth.ts:51` con `serverTimestamp()`. Formatear con `toLocaleDateString("es-MX")` para consistencia.
- **Null safety:** `email` puede ser null (aunque improbable en producción). Manejar con `email || "sin email"` para evitar renders vacíos.
