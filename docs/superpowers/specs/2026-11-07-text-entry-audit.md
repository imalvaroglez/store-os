# Auditoría de captura de texto — contrato por campo (#219)

Estado: **borrador — fase 1 (flujo Pedidos)**. Este documento es el inventario vivo; cada flujo se agrega con su matriz cuando se audita. Las pruebas viven junto al código del flujo; aquí se registra el contrato y su cobertura.

Metodología: por campo se declara (1) significado y tipo persistido, (2) requerido/opcional y rangos, (3) caracteres válidos/inválidos según propósito, (4) normalización en escritura y al guardar, (5) teclado móvil y recuperación ante error. No se aplica una política global: cada contrato sale del propósito del dato. Los defectos encontrados abren issue propia; aquí quedan marcados.

## Flujo: Pedidos (`OrderForm`)

| # | Campo (etiqueta) | Componente / archivo | Tipo persistido | Contrato | Cobertura |
|---|---|---|---|---|---|
| 1 | Cliente | `SearchSelect` · OrderForm.tsx | `customerId` + texto de búsqueda (no persiste) | Requerido para guardar. Búsqueda por nombre/teléfono; se liga por selección o nombre exacto único. Nombres con acentos/ñ se buscan en es-MX. Un valor sin liga **no** debe dejar guardar sin explicación (defecto #232 ya corregido: PR #236). | e2e smoke (emulador) + regresiones #232 |
| 2 | Producto (por línea) | `SearchSelect` · OrderForm.tsx | `productName` (texto libre) + `productId?` | Opcional vincular; el texto capturado ES el nombre de la línea. Acentos/ñ permitidos; **no se recorta mientras se escribe, se limpia (trim) al persistir** (fase 1b). | OrderForm.test fase 1b |
| 3 | Cantidad | `TextField` inputMode=numeric | `quantity: number` (vía `parseAmount`) | Solo enteros ≥ 0; sanitiza en escritura (`sanitizeIntegerInput`); nunca NaN al estado. | e2e + unit existentes |
| 4 | Precio unitario | `TextField` inputMode=decimal | `unitPrice: number` | Decimal con punto; se conserva el texto mientras se escribe (12 → 12. → 12.3); rangos protegidos (RangeError → mensaje). | #188 (regresiones decimal) |
| 5 | Anticipo | `TextField` | `deposit: number` | Decimal ≥ 0; heredado: bloqueado si materializado (#218). | OrderForm.test (#218/#225) |
| 6 | Número de cuotas | `TextField` inputMode=numeric | `installments.count` | Entero ≥ 1 cuando el plan está activo. | #165 (plan de pagos) |
| 7 | Frecuencia / primera fecha | `SelectField` / `TextField` date | enum / ISO date | Selección cerrada; fecha requerida con plan activo. | #165 |
| 8 | Fecha prometida | `TextField` type=date | `promisedDate` ISO | Opcional; válida persiste tal cual, vacía se omite; basura no alcanza el estado (el input date sanitiza — verificado). | OrderForm.test fase 1b |
| 9 | Estado del pedido | `SelectField` | enum | Selección cerrada (Preguntó…Cancelado). | e2e |
| 10 | Notas | `TextArea` | `notes: string` | **Contrato nuevo (fase 1a)**: opcional, multilínea; conserva acentos, ñ y saltos de línea tal cual al guardar y reabrir; sin límite artificial más allá del documento; no se trim al escribir (solo al comparar). | **agregada en este PR** |

### Pruebas de contrato fase 1a (este PR)

- Notas: texto con acentos/ñ/saltos de línea → se persiste idéntico y reaparece igual tras guardar+reabrir.

### Pruebas de contrato fase 1b (2026-11-10, sesión ZCode)

- Fecha prometida: válida persiste tal cual; vacía se omite del documento; basura jamás alcanza el estado (el input date sanitiza a "") — 3 aserciones en OrderForm.test.
- Producto libre: los espacios extremos NO se recortan mientras se escribe (contrato de captura) y SÍ al persistir (nombre limpio en el pedido).
- **Defecto encontrado y corregido (misión de operadora):** la búsqueda de clienta por teléfono dictado no encontraba el número guardado. SearchSelect ahora aplica una segunda pasada «laxa»: diacríticos plegados (maria jose → María José) y solo letras/dígitos («55-1234 5678», «(55) 1234-5678» → 5512345678, y la dirección inversa). La pasada literal conserva el comportamiento exacto previo. **Trade-off aceptado (revisión):** la fusión letras+dígitos puede teóricamente cruzar el borde label/keywords («os car» vs «Rios»+«Carpintería»); con keywords reales (clave/teléfono/instagram) el caso dominante es el buscado.

## Flujo: Clientas (`CustomerForm`) — completo (2026-11-10)

| # | Campo | Contrato | Cobertura |
|---|---|---|---|
| 1 | Nombre | Requerido; trim al guardar. Duplicado con acentos/caso insensible → **aviso suave** («¿es la misma persona?»), nunca bloqueo. | CustomerForm.test |
| 2 | Teléfono | inputMode=tel; captura conserva separadores de WhatsApp (espacios/guiones/paréntesis/+/puntos) y rechaza letras/emojis (`sanitizePhoneInput`, máx 24); al guardar exige ≥8 dígitos; persiste tal cual (la búsqueda normaliza ambos lados). | CustomerForm.test |
| 3 | Instagram | Sin espacios jamás (en escritura y al guardar); @ opcional; trim al guardar. | CustomerForm.test |
| 4 | Nivel de precio / segmento | Selección cerrada; nivel inválido bloquea con mensaje. | preexistente + test nombre distinto |

Menores UX del pedido integrados aquí: «+ Nuevo cliente» precarga lo tecleado (número→teléfono, texto→nombre); el Guardar deshabilitado explica «Elige o crea una clienta»; `autocomplete="off"` en búsquedas.

### Pendiente (fase 1b en adelante)

- [x] Pedidos: fecha prometida (inválida/omitida), producto libre (espacios extremos), búsqueda de clienta por teléfono con espacios. — fase 1b completa (2026-11-10).
- [x] Clientas (`CustomerForm`): Nombre (unicidad), Teléfono (dígitos/`+`), Instagram (@), Nivel. — completo (2026-11-10).
- [ ] Productos (`ProductForm`): Nombre, Clave/SKU (única, mayúsculas), costos/precios por nivel, En existencia/Alerta en, URL de imagen.
- [ ] Compras (`PurchaseForm`): folio, código del ticket (#206 ya cubre preservación), importes (#206/#207).
- [ ] Público: búsqueda del catálogo, carrito por WhatsApp.
