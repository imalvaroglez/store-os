---
Delivery-ID: unified-products
Delivery-Status: Pending approval
specPath: docs/superpowers/specs/unified-products-design.md
---
# Diseño unificado de productos

## Problema / Causa raíz (verificada en código)

Hoy el admin tiene **dos paths independientes para editar los mismos campos del producto**, creando confusión y fricción:

1. **Catálogo → Productos** (`CatalogScreen.tsx`): muestra el formulario `ProductForm.tsx` con todos los campos del producto (líneas 418-446 editan `cost`, `prices`, `quantityOnHand`, `lowStockAt`).
2. **Inventario → + Compra** (`InventoryScreen.tsx` + `PurchaseForm.tsx`): el flujo de compra también edita `cost` y `prices` inline (líneas 188-215 de PurchaseForm), y actualiza `quantityOnHand` vía `applyPurchaseLines()`.

**El problema es de navigation, no de datos:** `ProductForm` **YA EDITA** stock, costo y precios (verificado en `src/features/catalog/ProductForm.tsx:418-446`). No necesitamos cambiar el modelo de datos ni duplicar lógica.

## Objetivo

Consolidar la administración de productos en **una sola pestaña "Productos"** que contiene:
1. La lista de productos (ahora en CatalogScreen)
2. Categorías (ahora en `/catalogo-admin/categorias`)
3. Compras (ahora accesibles desde Inventario)

## Alcance (in)

1. **Crear una nueva pantalla "ProductosScreen"** que reemplace `CatalogScreen` como la vista principal de productos
2. **Mover Categorías dentro de Productos** como un sub-tab o panel interno
3. **Mover Compras dentro de Productos** como un sub-tab o panel interno  
4. **Eliminar la pestaña "Catálogo"** del navigation (navItems.ts líneas 21-28)
5. **Mantener Inventario solo para stores inventory_tiered** pero simplificado a solo la vista de ajustes +/- y stats (Disponible/Comprometido/Físico)
6. **Preservar toda la funcionalidad existente:** ProductForm, PurchaseForm, CategoriesScreen siguen funcionando igual, solo cambian de ubicación en la navegación

## Fuera de alcance (out)

1. No se cambia el modelo de datos `Product` ni `Purchase` — son correctos
2. No se modifica `ProductForm` ni `PurchaseForm` — ya editan los campos correctos
3. No se alteran las reglas de negocio de stock/cost/prices
4. No se implementa un nuevo formulario de productos
5. No se cambian los permisos ni aislamiento entre tiendas

## Diseño

### Estructura de navegación propuesta

**Antes (navItems.ts líneas 19-33):**
```
- Inicio
- Catálogo (parent)
  - Productos
  - Categorías
- Pedidos
- Clientes
- Inventario (solo inventory_tiered)
```

**Después:**
```
- Inicio
- Productos (parent)
  - Productos (lista y CRUD)
  - Categorías
  - Compras (solo inventory_tiered)
- Pedidos
- Clientes
- Inventario (solo inventory_tiered, reducido a ajustes manuales +/-)
```

### Implementación UI

1. **Nueva `ProductosScreen`**: envoltorio con tabs internos o botón de toggle
   - Tab principal: lista de productos (reutiliza `CatalogScreen` contenido, lines 154-192)
   - Tab secundario: Categorías (reutiliza `CategoriesScreen` contenido)
   - Tab terciario (solo inventory_tiered): Compras (reutiliza `PurchaseList` y botón "+ Compra")

2. **InventarioScreen simplificado**: 
   - Remueve los botones "Compras" y "+ Compra" (líneas 60-65 de InventoryScreen.tsx)
   - Solo conserva los ajustes +/- y stats (líneas 78-132)

3. **navItems.ts actualizado**:
   - Renombrar `catalogo` → `productos`
   - Renombrar hijos `catalogo_productos` → `productos_productos`, `catalogo_categorias` → `productos_categorias`
   - Agregar hijo `productos_compras` (solo visible en inventory_tiered)

4. **Router actualizado**: mapear `/productos` → nueva ProductosScreen

### Referencias concretas al código existente

- **ProductForm ya edita todo**: `src/features/catalog/ProductForm.tsx:418-446` tiene los campos de costo, precios y cantidad
- **PurchaseForm edita precios inline**: `src/features/inventory/PurchaseForm.tsx:188-215` muestra que el flujo de compra ya puede ajustar precios
- **Categorías funcionan bien**: `src/features/catalog/CategoriesScreen.tsx` está completo y no necesita cambios
- **InventarioScreen mix**: `src/features/inventory/InventoryScreen.tsx:60-65` son los botones que se moverán a Productos

### Ponytail

- Reutilizamos `CatalogScreen` casi intacto (solo cambiamos su contenedor)
- Reutilizamos `CategoriesScreen` y `PurchaseList` sin cambios
- No creamos nuevos componentes, solo reorganizamos los existentes
- La separación entre "ver productos" vs "ajustar inventario" se mantiene vía el tab Inventario (solo ajustes +/-)

## Criterios de aceptación

1. ✅ La pestaña "Catálogo" desaparece del nav (móvil y desktop)
2. ✅ Nueva pestaña "Productos" con dropdown o tabs internos: Productos, Categorías, (Compras si inventory_tiered)
3. ✅ La lista de productos se ve idéntica a antes (mismo `ProductCard`, mismo `ProductForm` al editar)
4. ✅ Categorías funciona igual que antes, solo accesible desde Productos
5. ✅ Compras funciona igual que antes, solo accesible desde Productos
6. ✅ Inventario (solo inventory_tiered) muestra solo los ajustes +/- y stats, sin botones de compras
7. ✅ URL routing funciona: `/productos` → ProductosScreen, `/productos/categorias` → tab categorías, `/productos/compras` → tab compras
8. ✅ No hay cambios en el modelo de datos ni en los forms existentes
9. ✅ La edición de stock/cost/prices desde ProductForm sigue funcionando
10. ✅ La creación de compras con edición de precios inline sigue funcionando

## previewChecks

```json
{
  "smoke": [
    {
      "name": "NavProductosVisible",
      "viewport": "mobile",
      "action": "login_and_select_store",
      "expect": "BottomNav muestra 'Productos' con dropdown (NO 'Catálogo')"
    },
    {
      "name": "ProductosLista",
      "viewport": "mobile",
      "action": "navigate(/productos/productos)",
      "expect": "Lista de productos idéntica a la actual CatalogScreen"
    },
    {
      "name": "CategoriasDentroDeProductos",
      "viewport": "mobile",
      "action": "navigate(/productos/categorias)",
      "expect": "Pantalla de categorías funcionando igual que antes"
    },
    {
      "name": "ComprasDentroDeProductos",
      "viewport": "mobile",
      "action": "navigate(/productos/compras) en store inventory_tiered",
      "expect": "Pantalla de compras con botón '+ Compra' funcionando"
    },
    {
      "name": "InventarioSimplificado",
      "viewport": "mobile",
      "action": "navigate(/inventario) en store inventory_tiered",
      "expect": "Solo ajustes +/- y stats, SIN botones de compras"
    },
    {
      "name": "ProductFormEditaStock",
      "viewport": "mobile",
      "action": "editar un producto desde Productos",
      "expect": "Formulario muestra campos de cost, prices, quantityOnHand como ahora"
    },
    {
      "name": "PurchaseFormEditaPrecios",
      "viewport": "mobile",
      "action": "crear nueva compra desde Productos/Compras",
      "expect": "Formulario permite editar precios inline como ahora"
    }
  ],
  "regression": [
    {
      "name": "CatalogoNoExiste",
      "viewport": "mobile",
      "action": "check_nav",
      "expect": "Nav NO tiene pestaña 'Catálogo'"
    },
    {
      "name": "InventarioNoTieneCompras",
      "viewport": "mobile",
      "action": "navigate(/inventario)",
      "expect": "NO hay botones 'Compras' ni '+ Compra' en Inventario"
    }
  ]
}
```

## Riesgos

1. **Bajo:** Reorganización de UI es intrusiva visualmente; el usuario puede tardar en adaptarse al nuevo lugar de Categorías/Compras.
2. **Bajo:** URLs cambian (`/catalogo-admin/*` → `/productos/*`); bookmarks externos se rompen (probabilidad baja: admin es privado).
3. **Medio:** Si un usuario tenía abierto `/catalogo-admin/productos` en una tab, el redirect puede fallar; mitigamos agregando redirect temporal.

## Dependencias

- Ninguna: esta entrega es puramente de reorganización de navegación/UI sin cambios de backend ni modelo de datos.
