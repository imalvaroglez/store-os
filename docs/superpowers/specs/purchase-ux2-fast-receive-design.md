---
Delivery-ID: purchase-ux2-fast-receive
Delivery-Status: Approved
Approved-By: Álvaro González (PO) — aprobación explícita en sesión 2026-08-22 + merge del PR #48
specPath: docs/superpowers/specs/purchase-ux2-fast-receive-design.md
---

# UX iteración 2 — Recepción rápida de compras

## Problema

El flujo de compras con importación PDF existe solo en la rama `feat/purchase-pdf-import` (4 commits, ~1,338 líneas, **no mergeada**: su historial contiene PII del recibo real). Aunque la lógica base funciona (Tesseract + parser con suite §31), la UX de revisión no escala al caso real de Olivia: **50 renglones**. Problemas concretos:

1. `sourceAmountType` es documental pero el editor no ofrece resolución global (`Unitarios` / `Total por línea`); cada línea `unknown` se corrige a mano.
2. Creación de productos **uno por uno** vía Sheet — inviable para ~50 líneas nuevas.
3. Editor sin tabla densa ni footer sticky; móvil con reflow de 2 columnas sin jerarquía.
4. La fecha del PDF (`dateLabel` del parser) se ignora: la compra siempre queda "hoy".
5. `receivePurchase(purchaseId)` no valida que los productos existan/pertenezcan a la tienda (`applyPurchaseLines` salta los desconocidos en silencio).

**Meta medible:** revisar 50 líneas en **menos de 5 minutos en escritorio**; móvil completa el flujo sin desbordes ni controles inaccesibles.

## Base de la entrega

Esta entrega incluye el **port limpio de la feature completa + UX2**: rama desde `main`, aplicando un diff sanitizado de `feat/purchase-pdf-import` con **allow-list explícita de paths** (solo PDF/parser/lifecycle/compras + sus tests; sin `AuthScreen.tsx` ni otros cambios ajenos que arrastra el diff, sin `dist-*`). Sin cherry-pick (historial con PII). El PDF real (`docs/superpowers/specs/receipt.pdf`) queda fuera de Git (`.gitignore`) y el fixture OCR (`functions/src/__fixtures__/receipt-ocr.txt`) se anonimiza (nombre, domicilio, teléfono, correo) preservando encabezados, orden de secciones, saltos y marcadores de página. La rama remota con PII no se reutiliza ni se elimina sin autorización explícita.

## Diseño

### 1. Contratos y tipos (`src/types/index.ts`, `src/lib/money.ts`)

- `receivePurchase(purchase: Purchase): Promise<"received" | "already">` — local usa el snapshot recién guardado; cloud conserva la relectura canónica dentro de `receivePurchaseTx` (`src/app/firebase/firestoreData.ts`).
- Validación de productos en **ambos planos**: cloud (`receivePurchaseTx` aborta si algún `productId` no existe o pertenece a otra tienda) **y local** (`receivePurchase` valida en `StoreProvider` que todos los productos existan y compartan `storeId` antes de `applyPurchaseLines`).
- Total = `mercancía − descuento + envío + impuesto adicional`. `taxIncluded` queda como dato del parser; **no** se persiste en `Purchase.tax` (no sumar dos veces).
- Todo cambio en líneas, cantidades, costos, descuento, envío, impuesto o total invalida `confirmedMismatchAmount` (extender la invalidación existente en `updateLine` a los ajustes).
- Nuevos: `Purchase.dateInferred?: boolean`; `PdfApplyPayload.dateLabel?` (se queda local en `PurchasePdfImport.tsx`); `formatMoneyExact(n)` en `src/lib/money.ts` con `Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 })`.
- Estados visuales por línea **calculados, no persistidos**, ids ingleses con precedencia fija: `unknown → amount_review`, luego `!productId → unlinked`, luego `new_product`, finalmente `linked`. `canReceive` se deriva de `status === "ready"` (sin duplicar reglas en el UI).
- `recalcPurchaseStatus`: sin `ready` si hay líneas `unknown`, productos sin vincular o diferencias no confirmadas.

### 2. Parser (`functions/src/parser.js`, fixture)

- La reconciliación A/B (`reconcileAmountType`) se queda **documental**; su resultado se copia a cada `PurchaseLine.sourceAmountType` en el mapeo cliente (`PurchasePdfImport.tsx`). El parser no infiere por línea; los overrides viven en el borrador.
- Regresiones: exigir **exactamente 50 líneas** (hoy ≥40), importes mal reconocidos, productos fusionados, variantes absorbidas, fragmentos OCR conocidos. Limpieza conservadora: solo quitar caracteres con casos concretos documentados en tests.
- Fechas: el parser solo devuelve `dateLabel`. La conversión a ISO vive en una única función pura cliente `src/lib/dates.ts` (meses españoles sin `Date.parse`; sin año → fecha pasada más cercana en `America/Mexico_City`).
- Proveedor: corregir rama inalcanzable — match existente → "Usar"; ausencia → "Crear Colore" reutilizando `SupplierForm`.

### 3. Resolución de importes (`PurchaseForm.tsx`)

- Control global cuando existan líneas `unknown`: `Unitarios` / `Total por línea`. `unit` → `unitCost = sourceAmount`; `line` → `unitCost = sourceAmount / quantity`.
- Celda de estado por línea para corrección individual.
- Cambiar cantidad recalcula `unitCost` cuando el importe representa el total de línea.

### 4. Editor responsive (`PurchaseForm.tsx`)

- **Una sola implementación: CSS grid responsive** (sin `<table>`, sin roles ARIA de tabla fingidos). Escritorio: grid denso con header sticky (fila de labels fuera del scroll), filas 56–64 px. Móvil: mismo grid colapsado a filas de dos niveles, header oculto, sin scroll horizontal obligatorio.
- Conteos y filtros desde el estado calculado único; categorías mutuamente excluyentes que suman el total.
- Motivo de bloqueo visible junto a "Recibir mercancía".
- Footer sticky: solo total (`formatMoneyExact`), diferencia y acciones; `env(safe-area-inset-bottom)`. Ajustes/confirmación de diferencia en el contenido.
- Compras `received`: controles con `disabled` real.
- Metadatos: `dateLabel` → ISO vía `dates.ts` en `applyPdf`; `dateInferred` → "año sugerido" junto al campo fecha, se apaga al editar. `formatMoneyExact` solo para texto; inputs numéricos sin `$`. `SelectField` se mantiene ("Vincular producto…" + "Crear nuevo producto"; sin combobox).

### 5. Creación masiva de productos — cloud-only, vía `StoreProvider`

- `PurchaseForm` nunca llama `firestoreData` directamente: nuevo método de contexto `createDraftProductsForPurchase(products, purchase)` + **acción única de reducer** que refleja productos+compra en un dispatch.
- Disponible tras resolver importes y solo para líneas `unlinked`. Nombre = `name` + variante si existe. SKU contra lista acumulada del lote (`uniqueProductSku` + set propio) para evitar colisiones intra-batch.
- Un `writeBatch` (cloud): productos privados + compra con vínculos en el mismo commit. Máx 499 productos + 1 compra; error → todo sin cambios. Éxito → una sola actualización local. **Sin proyecciones públicas**. 51 escrituras facturables, dentro del free tier.

## Pruebas

- **Unit (`vitest`)**: fixture anonimizado con exactamente 50 líneas; nombres problemáticos; `dates.ts` (con/sin año, Mexico City); `formatMoneyExact` (centavos); aritmética total; estados de línea calculados; invalidación de mismatch al tocar ajustes; `recalcPurchaseStatus` sin `ready` sin vínculo.
- **`npm run test:rules`**: permisos y aceptación del batch contra el emulador.
- **`npm run e2e:firebase`** (no el `e2e` local): comportamiento real de `receivePurchaseTx` (producto inexistente/ajeno) + UI con compra sembrada de 50 líneas en el emulador — tabla, filtros, resolución global, bulk create, bloqueo con motivo, recepción. Sin Tesseract en el E2E.
- Validación manual del PDF real (escritorio + móvil, cronometrar los 5 min) — humana; la entrega deja instrucciones.

## Preview check

```json
{ "path": "/", "selector": "body", "text": "Entrar" }
```

## Supuestos

- Sin matching automático, fuzzy ni modelo de variantes (la variante vive en el nombre).
- Bulk create y flujo PDF: cloud-only; modo demo local intacto (manual).
- Meta de 5 min en escritorio; móvil = paridad funcional.

## Costo

51 escrituras facturables en el batch (50 productos + compra) por importación grande; cualquier otra operación es de las ya existentes. Muy dentro del free tier.
