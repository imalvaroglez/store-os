# Diseño: Importar pedido de proveedor desde PDF (OCR en backend)

**Delivery-ID:** purchase-pdf-import
**Delivery-Status:** Pending approval
**Fecha:** 2026-08-20 (rev. 2: OCR movido a backend por decisión del PO)
**Autor:** agente (diseño), PO (aprobación)

## Problema

Fer (Olivia) hace compras grandes de inventario. El proveedor le manda un
PDF con: número de pedido, fecha, y un listado de producto, color, cantidad
y total en pesos mexicanos. Hoy ella captura todo a mano en la compra
(`PurchaseForm`), lento y propenso a errores en pedidos de decenas de
líneas.

**Hecho clave:** el PDF real del proveedor es un escaneo (5 páginas de
imágenes, sin capa de texto) → la lectura automática requiere OCR.

## Decisión del PO (rev. 2)

OCR **en el backend** (Cloud Function), no en el cliente:

- La compra es infrecuente: el costo marginal por pedido es trivial y la
  UX (sin 15 MB de modelo ni minutos de CPU en el móvil de la clienta)
  pesa más.
- Fer es clienta cero; el feature se calibra a su medida y se probará
  manualmente en local ANTES de que ella lo vea en preview.
- El riesgo de cobro se encapsula con guardrails (abajo), no evitándolo.

La función es opcional de usar: la captura manual queda intacta siempre.

## Propuesta

1. En `PurchaseForm`, botón "Importar pedido (PDF)".
2. El PDF se sube a Storage (`purchases/<storeId>/<id>.pdf`) con las reglas
   existentes (miembro de la tienda; documento privado).
3. Callable `importPurchasePdf`:
   a. Renderiza páginas con `pdfjs-dist` (Node) y corre OCR con
      `tesseract.js` + modelo `spa` (descargado al deploy, no por
      invocación).
   b. **Parser con heurísticas de tabla genéricas** (no plantilla fija por
      proveedor): líneas con patrón (texto) (cantidad) ($monto); folio y
      fecha por regex en español/inglés; montos `$1,234.50` MXN. Se calibra
      contra el PDF real de ejemplo (incluido en el repo para tests).
   c. Escribe el resultado estructurado a una subcolección temporal
      `stores/{id}/pdfImports/{importId}` (TTL de limpieza en lectura).
4. **Pantalla de revisión humana OBLIGATORIA** antes de aplicar: cada campo
   editable, líneas dudosas marcadas, total detectado vs. suma calculada
   con aviso si no cuadran. Nada se aplica sin confirmación.
5. Al confirmar: líneas agregadas a la compra (match por nombre de
   producto existente; desconocidos quedan marcados sin auto-crear), folio
   y fecha llenan sus campos, PDF adjunto y descargable desde la compra.

## Guardrails cero-costos (requisitos)

- Callable function llamada SOLO por acción explícita del usuario (sin
  trigger de Storage → sin re-disparos).
- `maxInstances: 1`, `retry: false`, `memory: "1GB"`, `timeoutSeconds: 540`,
  `minInstances: 0`.
- Presupuesto GCP con alerta canario ($1 MXN/mes) — configuración manual
  del PO, documentada en DEPLOYMENT.md.
- Consumo estimado: ~120 GB-seg/pedido; 500 pedidos/mes = 15% del free
  tier de Functions.

## Modelo de datos

```ts
// Purchase gana:
documentUrl?: string;   // Storage download URL del PDF
supplierOrder?: string; // folio/número de pedido del proveedor
```

Sin cambios en `PurchaseLine` ni totales.

## Parser — expectativa honesta

Heurísticas genéricas para cualquier proveedor con formato tabular;
calibrado contra el PDF real. OCR sobre escaneos limpios (300dpi) rinde
90–97%; los errores típicos (`l`↔`1`, columnas pegadas) se corrigen en la
revisión. Lo no reconocido llega vacío a la revisión — nunca se inventa
dato ni se guarda sin validación humana.

`ponytail:` soporte explícito multi-formato es YAGNI hasta que exista un
segundo proveedor real; las heurísticas de tabla son el mecanismo flexible.

## Emuladores / pruebas

- La función corre en el emulador de Functions para desarrollo local y CI
  (tesseract.js funciona en Node; el modelo spa se cachea).
- Pruebas unitarias del parser contra el texto OCR del PDF ejemplo.
- e2e (emulador): importar un PDF de una página generado en el test y
  verificar la compra resultante tras la revisión.

## UI (mobile-first, español MX)

- Botón "Importar pedido (PDF)" al inicio de `PurchaseForm`.
- Sheet "Revisar pedido importado": encabezado (folio, fecha, total
  detectado) + tabla editable de líneas (producto, cantidad, costo
  unitario, importe) + aviso si total ≠ suma. Botón "Agregar a la compra".
- En la compra guardada: fila "Pedido proveedor" con folio + enlace al PDF.
- Componentes del design system; inputs ≥16px; tap targets ≥40px.

## Fuera de alcance (V1)

- PDFs con capa de texto (se OCR-ean igual; optimizar por esa vía es V2).
- Auto-crear productos desde líneas.
- OCR de escritura a mano.

## Aceptación

1. En local (emuladores), importar el PDF real → folio, fecha y ≥90% de
   líneas correctamente extraídas en la revisión.
2. Editar cualquier campo antes de aplicar; confirmación obligatoria.
3. Aplicar → compra con líneas, costo unitario = importe ÷ cantidad, folio
   y fecha llenos, PDF descargable.
4. Producto inexistente → línea marcada, sin auto-crear.
5. OCR fallido/página ilegible → mensaje claro, flujo manual intacto.
6. Función desplegada con los guardrails de configuración arriba.
7. Validación manual del PO en local antes de preview (requisito del PO).
