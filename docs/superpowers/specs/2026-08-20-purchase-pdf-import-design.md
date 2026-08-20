# Diseño: Importar pedido de proveedor desde PDF

**Delivery-ID:** purchase-pdf-import
**Delivery-Status:** Pending approval
**Fecha:** 2026-08-20
**Autor:** agente (diseño), PO (aprobación)

## Problema

Fer (Olivia) hace compras grandes de inventario. El proveedor le manda un PDF
con: número de pedido, fecha, y un listado de producto, color, cantidad y
total en pesos mexicanos. Hoy ella captura todo a mano en la compra
(`PurchaseForm`), que es lento y propenso a errores en pedidos de decenas de
líneas.

## Propuesta

La compra existente gana **importación desde PDF**:

1. En `PurchaseForm`, botón "Importar pedido (PDF)".
2. Ella elige el PDF; la app extrae el texto **en el cliente** con
   `pdfjs-dist` (sin backend, sin costo de Functions).
3. Un parser propio lee: folio/pedido, fecha, y líneas
   (producto + color, cantidad, importe). El importe por línea se divide
   entre la cantidad para obtener el costo unitario.
4. **Pantalla de revisión antes de aplicar:** cada campo extraído llega
   editable. Lo que el parser no reconoció queda vacío y se llena a mano.
   Nada se guarda sin confirmación de Fer.
5. Al aplicar: las líneas se agregan a la compra (matches por nombre de
   producto existente; los que no existen quedan como línea nueva marcada
   para crear el producto), folio y fecha llenan sus campos.
6. El PDF se guarda en Storage (`purchases/<storeId>/<purchaseId>.pdf`),
   adjunto a la compra, descargable desde la lista/detalle.

### Parser — expectativa honesta

El formato del PDF varía por proveedor. V1 parsea **el formato del
proveedor actual de Olivia** (se trabaja contra un PDF de ejemplo real que
el PO proporciona). Cualquier cosa que no encaje cae en la pantalla de
revisión con lo que sí se pudo leer; nunca falla en silencio ni inventa
datos. Si en el futuro hay un segundo proveedor, se agrega su formato como
caso adicional del mismo parser.

`ponytail:` un parser genérico multi-proveedor es YAGNI hasta que exista
un segundo proveedor real.

## Modelo de datos

```ts
// Purchase gana:
documentUrl?: string;   // Storage download URL del PDF
supplierOrder?: string; // folio/número de pedido del proveedor
```

Sin cambios en `PurchaseLine` ni en los totales existentes.

## Costo (restricción cero-costos)

- **Extracción:** `pdfjs-dist` corre en el navegador. Añade ~1–2 MB al
  bundle (dynamic `import()` solo al usar el importador). Sin API paga.
- **Storage:** un PDF de pedido ~100–500 KB. Free tier: 5 GB almacenamiento
  y 5K uploads/mes — sobrado para el volumen de Olivia (< 100/mes).
- **Firestore:** cero escrituras extra (solo los campos nuevos en el doc de
  la compra).

## Reglas / seguridad

- Subida con las reglas de Storage existentes (miembro de la tienda).
- El PDF es documento privado de la tienda: nunca en proyecciones públicas
  (`publicStores`/`publicProducts` intocados).

## UI (mobile-first, español MX)

- Botón "Importar pedido (PDF)" al inicio de `PurchaseForm`.
- Sheet "Revisar pedido importado": encabezado (folio, fecha, total
  detectado) + tabla editable de líneas (producto, cantidad, costo unitario,
  importe). Botón "Agregar a la compra".
- En la compra guardada: fila "Pedido proveedor" con folio + enlace al PDF.
- Todo con componentes del design system; inputs ≥16px; tap targets ≥40px.

## Fuera de alcance (V1)

- Parsear formatos de proveedores distintos al actual.
- PDFs escaneados (imagen sin texto) — se avisa y se captura a mano.
- Auto-crear productos desde las líneas (se hace desde el flujo existente).

## Aceptación

1. Subir el PDF de ejemplo → folio, fecha y ≥95% de líneas correctamente
   extraídas en la pantalla de revisión.
2. Editar cualquier campo en la revisión antes de aplicar.
3. Aplicar → la compra queda con las líneas, costo unitario = importe ÷
   cantidad, folio y fecha llenos; el PDF descargable desde la compra.
4. Producto inexistente en una línea → línea visible marcada, sin crear el
   producto automáticamente.
5. PDF sin texto (escaneado) → mensaje claro, sin crash, flujo manual intacto.
6. e2e (emulador): importar un PDF generado en el test y verificar la
   compra resultante. Test unitario del parser con el texto del PDF ejemplo.
7. En demo local (sin sesión) el importador funciona sin Storage (PDF no se
   guarda, solo se importan las líneas).
