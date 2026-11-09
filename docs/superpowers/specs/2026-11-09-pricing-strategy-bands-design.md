# Estrategia de precios por categoría — diseño (2026-11-09)

Issue: #280 (continúa la sesión de configuración que #254 dejó pendiente).
Autorización: PO 2026-11-09 (spec del PO + ajustes v2). Entrega funcional a producción el mismo día.

## Contrato

- **No hay un segundo motor.** El motor de #254 (`src/lib/pricingRules.ts`) sigue siendo el único que resuelve sugerencias: precedencia producto > categoría > general, bandas `[min, max)` semiabiertas, banda elegida por **costo de adquisición**, costo base = adquisición + empaque `perPiece` del nivel (el `perOrder` jamás entra a un precio).
- Lo nuevo: `src/lib/pricingBands.ts` (análisis + propuesta determinista), `PricingStrategyScreen` (Productos → Estrategia de precios) y `saveCategoryPricingRules` (grabación transaccional por categoría).
- La pantalla serializa UNA tabla por categoría (límites compartidos + tres precios) en `PricingRulesConfig.byCategory[catId][tierId] = { kind: "bands", bands, rounding: "none" }` para cada nivel visible — tres reglas con límites idénticos.

## Generador (`proposeCategoryBands`)

Función pura: misma entrada ⇒ misma propuesta. Aritmética en centavos enteros; límites y precios en pesos.

1. **Cohorte:** SKUs de la categoría principal (`categoryIds[0]`) con `cost > 0`.
2. **Soporte estadístico de la estructura:** alta (≥20 SKUs y ≥5 costos distintos), media (≥8 y ≥3), baja (≥4); menos ⇒ sin propuesta ("Muestra insuficiente").
3. **Cortes candidatos:** los `k−1` **huecos naturales** mayores de la distribución (salto relativo ≥25% entre costos distintos consecutivos; corte en el punto medio del hueco), completados con cuantiles `i/k` si faltan. Cada corte se ajusta a un **límite comercial**: costo observado dentro de $3 primero, luego múltiplo de $5 (o $10 si el rango ≥$200) dentro de $3; un ajuste que salga del hueco se descarta y se usa el punto medio.
4. **Validez:** sin bandas vacías; banda con <4 SKUs o <15% de la categoría invalida el candidato; contigüidad exacta `max[i] === min[i+1]`; última banda abierta.
5. **Puntaje** por k ∈ [1..6]: `0.5·separación + 0.35·cohesión + 0.15·(1/k)` donde separación = mínimo gap relativo entre medianas de bandas adyacentes (lleno a 35%) y cohesión = promedio del porcentaje de SKUs que ya cobran el precio modal de su banda. Empate ⇒ k menor.
6. **Anti-trivial:** si algún k≥2 válido separa ≥15%, k=1 queda excluido ("una sola banda escondería la diferencia").
7. **Precios (evidencia, no verdad):** mediana de precios actuales de la banda por nivel, atípicos IQR de la categoría excluidos, redondeada a la escalera de $10 (propuesta editable). <3 valores ⇒ `weak`; 0 valores ⇒ `null` **pendiente** (nada inventado). Confianza comercial por nivel separada del soporte estadístico: Iconic = pedidos+precios, Girly = precios, Regular = referencia (sin demanda observada en puntos físicos).
8. **Contribución mínima por banda:** precio − costo base del SKU más caro de la banda. Materiales `perPiece` sin `estimatedCost` marcan el costo base **incompleto** (advertencia explícita; nunca $0 engañoso).
9. **Advertencias** (no bloqueantes, decisión de Fer): medianas que violan Regular > Girly > Iconic; piezas sin costo confiable fuera de la tabla.

Parámetros en `BANDS_PARAMS` (constantes documentadas).

## Integridad y concurrencia (`saveCategoryPricingRules`)

`savePricingRules` reemplaza el campo `pricingRules` completo: un clone client desactualizado borraba `byTier`/`byProduct`/otras categorías. La nueva vía (`firestoreData.ts`, patrón `runTransaction`):

1. Lee el doc **fresco** de `stores/{id}` dentro de la transacción.
2. Sobrepone **solo** `byCategory[catId]` (o borra la llave con `null` — la eliminación es real porque el campo se reescribe completo).
3. Escribe `pricingRules + updatedAt` (cumple `storeSettingsUnchanged`: los miembros pueden escribirlo).

Conflicto misma categoría: gana la última escritura (serialización Firestore). La UI además detecta cambios concurrentes (draft sucio vs firma guardada) y muestra banner con "Descartar mis cambios y recargar"; nunca pisa en silencio. Una config existente incompatible (reglas no-bands o límites distintos entre niveles) se muestra, se explica y solo se reemplaza con el botón explícito "Reemplazar con la propuesta".

## Pantalla

Recorrido: **categoría → resumen de costos (lenguaje comercial) → propuesta con justificación (por qué k y no otra cantidad) → editar → guardar**.

- Editor: límites compartidos (editar un tope propaga contigüidad), tres columnas de precios, agregar/quitar/dividir banda, "Restaurar propuesta", piezas por banda con diferencial actual→sugerido (solo lectura).
- Precios pendientes bloquean el guardado; límites validados con `validateBands`.
- Escenario de impacto (solo lectura): cuántas subirían/bajarían por nivel — no proyección.
- **Sin flujo de aplicación propio:** aplicar precios vive en Productos → Reglas de venta (enlace directo). Guardar jamás toca productos.
- **Bajo costo (PO 2026-11-09):** una sugerencia bajo el costo base NO se aplica en lote. Una excepción por producto (`byProduct`) puede quedar bajo costo, pero aplicarla exige confirmación explícita EN EL MOMENTO (diálogo: Aplicar todo / Aplicar sin esos N / Cancelar) — una excepción previa no es autorización vigente para vender con pérdida. Registros de posible lote (unidad de compra ≠ unidad de venta) se SEÑALAN en el diagnóstico, jamás se corrigen solos; la adquisición sola nunca se presenta como costo comercial completo (empaques sin configurar ⇒ contribuciones preliminares).

## Diagnóstico (Fase A)

`scripts/analyze-product-costs.cjs` (patrón `analyze-order-mix.cjs`): solo `.get()`, allowlist de proyectos, `--self-test`, agregados sin PII, Olivia únicamente. Distingue adquisición / empaque individual / costo base completo-o-incompleto / empaque compartido; valida procedencia contra `costAllocations`.

## Permisos

Sin cambios de reglas: `pricingRules` ya es campo alcanzable por miembros (excepción `storeSettingsUnchanged`). Test extendido con payload `byCategory` real + lectura denegada a miembro de otra tienda.

## Pruebas

- `pricingBands.test.ts` (15): determinismo, multimodal no colapsa a k=1, unimodal→1 banda, muestra insuficiente, tablas pasan `validateBands`, pendientes sin inventar, empaque mueve contribución no límites, gaps de empaque, atípicos, violaciones de orden.
- `PricingStrategyScreen.test.tsx` (6): guarda solo la categoría con límites idénticos y sin `upsertProduct`; pendientes bloquean; incompatible requiere acción explícita; tabla compatible carga/edita/guarda; banner de sesión concurrente; eliminación con confirmación.
- `firestore.rules.test.ts`: payload `byCategory` por miembro OK; extraño no lee ni escribe.
- `e2e/pricing-strategy.spec.ts` (móvil 390px y escritorio): proponer→editar→guardar→**recargar persiste**; guardar no cambia precios (verificación REST); quitar tabla→recargar no resucita.

## Decisiones comerciales que quedan con Fer

Valores finales de las tres tablas de precios por banda; sustituir (o no) configs incompatibles; completar costos de materiales de empaque faltantes (hoy Olivia no tiene empaques individuales configurados → costo base = adquisición); precios Regular pendientes de validación en puntos físicos.
