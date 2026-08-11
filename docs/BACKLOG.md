# Backlog

Lista viva de capacidades candidatas para Store OS. Cada entrada describe el
**problema** (qué necesita la usuaria), el **alcance propuesto** (no es spec
aprobado — es un punto de partida), las **decisiones pendientes** que hay que
cerrar antes de spec, y los **datos disponibles vs faltantes**.

El flujo para mover una entrada a "en curso" es el **Product Loop** (LOOPS.md
§2): humano decide capacidad → spec aprobado → harness/agent implementa → QA →
deploy. Nada aquí está comprometido hasta que hay spec firmado.

Estado: `💡 idea` · `🔬 refining` · `📋 specced` · `🚧 in progress` · `✅ done` ·
`❄️ frozen`

---

## 💡 Recibos / comprobantes de venta imprimibles y PDF

**Estado:** 💡 idea
**Solicitó:** Fer (dueña de Olivia), vía Álvaro (2026-08-05)

### Problema

Fer quiere entregar a sus clientas un comprobante profesional cuando concreta
una venta: un recibo con el diseño de su marca, que se pueda **imprimir** o
**enviar como PDF** (por WhatsApp, normalmente). Hoy Store OS registra el
pedido pero no genera ningún documento para la clienta. Referencia mental de
Fer: Crystal Reports (un diseño único de reporte que se carga con datos y se
imprime/exporta).

### Alcance propuesto (MVP)

Un recibo por **pedido** (`Order`), generado en el navegador a partir de una
**plantilla de diseño fija** que refleja la marca de Olivia, rellena con los
datos del pedido + la clienta + la tienda. Botón "Imprimir / Guardar PDF" usa
`window.print()` con CSS `@media print` (el diálogo del navegador ya ofrece
"Guardar como PDF"). Sin diseñador visual embebido en esta iteración.

**Por qué no un diseñador visual (estilo Crystal Reports):** construir un
editor WYSIWYG de plantillas es un proyecto entero y es over-engineering para
una sola joyería. Fer entrega su diseño (imagen/Figma/papel) y se implementa
como plantilla. Si después quiere más control de marca, se añaden **tokens de
personalización** (logo, colores, texto fijo) — ese es el punto dulce, no un
editor completo.

### Datos disponibles vs faltantes

Ya en `Order` (`src/types/index.ts`): `productName`, `quantity`, `price`,
`deposit` (anticipo), `promisedDate`, `notes`, `status` (incl. `delivered`/
`paid`), `createdAt`.

Ya en la tienda: nombre, WhatsApp (`Store`).

**Faltan (a decidir en spec):**
- **Número de recibo consecutivo** por tienda (ej. `REC-0001`). Requiere un
  contador — probablemente un campo `receiptSeq` en `Store` incrementado al
  emitir, con cuidado de concurrencia (igual que el slug claim).
- **Datos de la clienta** en el recibo: nombre, teléfono. Hoy están en
  `Customer` (relacionado por `order.customerId`), hay que resolverlos.
- **Forma de pago** (efectivo/transferencia/tarjeta) y **saldo** (`price −
  deposit`). El saldo se calcula; la forma de pago es campo nuevo en `Order` o
  se captura al emitir.
- **Logo de la tienda** en el recibo (¿usar el del storefront? ¿uno aparte?).
- **Campos fiscal-ready** (ver decisión 1): forma de pago (clave SAT), uso del
  CFDI (default G03), unidad (default pieza=H87), RFC de la clienta
  (opcional). Capturados hoy, con defaults invisibles, para que el timbrado
  futuro no rediseñe el modelo.

**Campos fiscal-ready (capturar hoy, opcionales con defaults):**

| Campo | Default (no estorba hoy) | Por qué lo necesita la factura futura |
|---|---|---|
| Forma de pago | "Por definir" | El CFDI exige clave SAT (efectivo=01, transferencia=03, etc.) |
| Uso del CFDI | "G03 — Gastos en general" | Requerido por el SAT (uso que le da la clienta) |
| Unidad | "Pieza" (H87) | Cada línea del CFDI exige unidad SAT |
| RFC de la clienta | vacío (el recibo no lo exige) | La factura lo exige; se pide cuando la clienta lo solicite |
| Régimen fiscal de Fer | se configura una vez por tienda | Requerido en todo CFDI del emisor |

### Decisiones pendientes (cerrar antes de spec)

1. **¿Recibo o factura fiscal (CFDI)?** ⚠️ DECISIÓN TOMADA (2026-08-05):
   **Tamaño carta**, y **construimos fiscal-ready desde el MVP aunque no
   timbremos cada recibo**. La distinción que rige el diseño:
   - **Datos fiscales de la operación** (clienta, productos, montos, forma de
     pago, uso del CFDI, unidad, RFC) → se **capturan y guardan hoy**, sin
     costar nada. La mayoría son defaults invisibles para Fer.
   - **Timbrado** (enviar al PAC, recibir XML+PDF sellado) → **se pospone**.
     Cobra por comprobante, rompe cero-costos; es integración aparte.
   - **Principio:** el recibo de hoy captura ya los campos que una factura
     futura necesitará, para que cuando llegue el timbrado los datos ya estén
     y solo se añada el PAC encima — sin rediseñar el modelo ni recapturar
     historial. **No** se construye la integración PAC ahora (YAGNI + costo).
   - Flujo que esto habilita: Fer emite recibo normal → si la clienta pide
     factura después, los datos ya están; solo se confirma RFC y se timbra.

2. **¿Una plantilla por tienda o global?** Olivia es la primera, pero si hay
   más tiendas, ¿cada una sube su diseño? MVP: una plantilla Olivia; la
   arquitectura debe permitir por-tienda sin reescribir (YAGNI: no construir el
   multi-tienda hasta que haya 2+ pidiéndolo).

3. **¿Quién diseña la plantilla?** Fer diseña en **Canva** (herramienta que
   domina): paleta, tipografía, logo, layout, copy del encabezado. Exporta un
   PDF de muestra con datos de ejemplo. Ese PDF es la **referencia visual**;
   el diseño se **reconstruye como HTML/CSS** dentro de la app — Canva es el
   origen del diseño, NO el motor de plantillas (no se carga el archivo de
   Canva en runtime; Store OS rellena la plantilla HTML con los datos de cada
   pedido). MVP: implementar fielmente el diseño de Canva de Fer.

   3b. **Tamaño del recibo:** ¿carta/A4 (para imprimir en impresora normal o
   generar PDF para WhatsApp) o **ticket térmico** (rollo 58/80mm, impresora
   de punto de venta)? El CSS `@media print` es muy distinto para cada uno.
   Va al spec cuando se confirme con Fer.

4. **¿PDF nativo o `window.print()`?** `window.print()` + CSS print es gratis y
   suficiente (el diálogo del SO hace "Guardar como PDF"). Una librería de PDF
   (jsPDF/pdfmake) añade tamaño al bundle y complejidad. MVP: `window.print()`.

5. **Cero-costos:** confirmar que no hay servicio de backend (sin Cloud
   Function de render). Todo en el cliente.

### Out-of-scope explícito

- Facturación fiscal / CFDI / PAC (hasta que se decida, y asumiendo costo).
- Diseñador visual de plantillas embebido (YAGNI).
- Envío automático por WhatsApp (Fer puede "compartir" el PDF desde su teléfono
  tras guardarlo; el botón de WhatsApp ya existe en otro contexto).
- Plantillas para múltiples documentos (solo recibo de venta por ahora).

### Notas de implementación (cuando toque)

- El recibo es **proyección de solo lectura** de datos existentes (como el
  catálogo público) — no nueva colección salvo el contador de folio.
- CSS `@media print` con `@page` para tamaño (media carta / ticket térmico).
- Validar mobile-first: Fer opera desde el teléfono; el "Guardar como PDF"
  móvil debe ser obvio.
- Considerar que `Order` hoy parece ser **una línea por producto** (ver
  `productId`/`productName` singular). Un recibo suele agrupar varias líneas:
  confirmar si un "pedido" es un `Order` o un grupo de `Order`s (esto afecta
  el diseño del folio y el agrupamiento).

---

## 💡 Unificar Catálogo e Inventario en una sola pestaña "Productos"

**Estado:** 💡 idea
**Solicitó:** Álvaro (PO), 2026-08-11 — conversación de diseño

### Problema

Hoy el admin tiene dos pestañas separadas: **Catálogo** (`/catalogo-admin`, con
Productos y Categorías) e **Inventario** (`/inventario`, con stock, costo y
compras). Para una joyería pequeña como Olivia (una sola operadora, Fer), esa
separación es artificial: Fer no piensa "voy al catálogo a poner el precio y
luego al inventario a poner la existencia". Ella piensa "agrego un Anillo" con
todo junto (nombre, foto, precio, costo, cuántos tiene). Es **un solo objeto
mental**, hoy partido en dos pantallas.

La fricción ya se manifestó en esta sesión: el flujo de compra tuvo que añadir
"crear producto al vuelo" (F2) y "editar precio desde la compra" (F3)
**justamente porque stock y catálogo estaban desconectados**. Mover entre
"Catálogo → editar precio" e "Inventario → ver stock" del mismo producto es ir
y venir.

### Alcance propuesto (idea — requiere spec)

Fusionar en **una sola pestaña "Productos"** que muestre cada producto completo:
foto, nombre, precios, existencia y badge de publicado/borrador, todo junto.
Editar abre la ficha con todo (datos de catálogo + precios + stock + costo).
"Compras a proveedores" queda como sub-flujo (botón dentro de Productos o en
Ajustes). Las categorías pueden vivir dentro de la misma pestaña o en Ajustes.

- Una sola lista por producto con todos sus datos visibles.
- Una sola ficha de edición (la actual `ProductForm` ya casi lo es; habría que
  asegurar que existencia/costo sean editables ahí también, no solo vía compra).
- "Compras" y "Categorías" se reubican como sub-flujos.

### Datos disponibles vs faltantes

Ya existe casi todo: `Product` lleva `quantityOnHand`, `cost`, `prices`, fotos,
`status`. `ProductForm` ya edita catálogo+precios; solo le falta edición directa
de stock/costo (hoy solo vía compra). `InventoryScreen` y `CatalogScreen`
mergean en una.

### Decisiones pendientes (cerrar antes de spec)

1. ¿Edición directa de stock/costo en la ficha del producto, o solo vía
   "registrar compra"? (Hoy la compra hace el promedio ponderado; editar stock
   a mano rompería esa trazabilidad.)
2. ¿Dónde viven las Categorías y las Compras en el nuevo modelo?
3. ¿"Productos" como única pestaña de catálogo, o conservar "Categorías" aparte?

### Out-of-scope explícito

- Conteo de inventario avanzado / ajustes con motivo / auditoría (YAGNI).

---

## 💡 Precios escalables (nombres mutables + extensibles) y precio sugerido

**Estado:** 💡 idea
**Solicitó:** Fer (dueña de Olivia), vía Álvaro (2026-08-10)

### Problema

Olivia maneja **varios precios por producto** (hoy: mayoreo, menudeo,
emprendedora). Hoy existen como un enum fijo de 3 (`retail | wholesale | reseller`
en `ProductPrices`). Fer necesita que:

1. Los **nombres** de esos precios puedan **cambiar** (no son "retail/wholesale"
   para siempre — son etiquetas comerciales que ella controla).
2. Se puedan **agregar precios nuevos** sin rehacer tablas ni migrar esquema.
3. (Deseo futuro) Una **fórmula/técnica que sugiera el precio de venta al público
   a partir del costo** del producto.

### Alcance propuesto (idea — requiere spec)

- **Modelo extensible:** reemplazar el enum fijo por un modelo tipo
  `prices: { [tierId: string]: number }` + una definición de tiers **por tienda**
  (`store.priceTiers: { id, label, order }[]`). La tienda define cuántos precios
  hay y cómo se llaman; el producto solo guarda los valores por tier id.
- **Nombres mutables:** cambiar el `label` de un tier no rompe los productos (el
  id estable se mantiene; el label es cosmético).
- **Agregar/ordenar/quitar** tiers desde la configuración de la tienda, sin
  tocar documentos de producto existentes (los que no tengan un tier nuevo
  simplemente quedan sin ese precio).
- **Precio sugerido desde el costo** (sub-idea): cuando Fer captura el `cost`,
  sugerir un precio de venta con una regla configurable (markup %, margen
  objetivo). Es **asistente**, no obligación — ella puede sobreescribir. Va en
  su propia iteración; capturar la regla en `store.pricingRule`.

### Datos disponibles vs faltantes

**Hoy:** `Product.prices?: { retail?, wholesale?, reseller? }` (3 fijos, enum
duro), `Product.cost?`, `PriceTier` enum, campos en `ProductForm` y
`OrderForm`. El catálogo público y las órdenes leen `prices[tier]`.

**Faltan (a decidir en spec):**
- Definición de tiers por tienda (`Store.priceTiers`).
- Migración de `prices: {retail,wholesale,reseller}` → `prices: {[tierId]:n}`
  (idempotente, preserva datos).
- Cómo se elige el tier por defecto (¿el primero? ¿un `defaultTierId`?).
- Regla de precio sugerido (formato, dónde se configura).
- Cómo cambia el `OrderForm` (hoy usa `PriceTier` enum duro).

### Decisiones pendientes (cerrar antes de spec)

1. ¿Nombres de tier globales o por tienda? (Por tienda = Fer controla; implica
   `Store.priceTiers`.)
2. ¿Los tiers tienen orden explícito (para mostrar en forms/catálogo)?
3. ¿Precio sugerido = markup fijo, margen objetivo, o tabla por rango de costo?
4. Migración: ¿un tier id canónico para retail/wholesale/reseller existentes
   (`t_retail` etc.) para no perder datos?

### Out-of-scope explícito

- Descuentos por volumen complejos / reglas de pricing dinámico.
- Histórico de precios por producto (YAGNI).

### Nota

Este cambio **rediseña el modelo de precios** — es una feature con spec propia,
no un fix. Impacta tipos, `ProductForm`, `OrderForm`, catálogo público,
proyecciones y migración. Mientras tanto, el bug de que Olivia no mostraba los 3
precios existentes (porque `adminStores` no llevaba `type`) **ya está arreglado**
— los 3 precios actuales funcionan para Fer hoy.

---

<!--
Plantilla para nuevas entradas:

## 💡 [Título]

**Estado:** 💡 idea
**Solicitó:** [quién, cuándo]

### Problema
[Qué necesita la usuaria, en sus términos]

### Alcance propuesto (MVP)
[La versión más simple que resuelva el problema]

### Datos disponibles vs faltantes
[Qué hay en los tipos hoy, qué falta]

### Decisiones pendientes
[Preguntas que cerrar antes de spec]

### Out-of-scope explícito
[Lo que NO se hace esta iteración]
-->
