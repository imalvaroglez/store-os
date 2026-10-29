# Ensayo del Excel de Fer — reporte de incidencias (E0)

**Fecha:** 2026-10-28 (sesión E0) · **Herramienta:** `scripts/excel-trial-report.cjs`
(read-only, sin dependencias nuevas) · **Spec:**
[`docs/superpowers/specs/2026-10-28-e0-excel-trial-decisions-design.md`](superpowers/specs/2026-10-28-e0-excel-trial-decisions-design.md)

Fuente: `Ventas .xlsx` (sha256 `4c7c813b603b…`) leído **sin modificarse** (hash verificado
antes/después por el propio script). Nombres de clienta anonimizados; `report.json` completo
queda fuera del repositorio. Este documento es evidencia reproducible para OLI-035 y la
sesión de decisiones (D01–D15).

## Resultado por hoja

### Inventario

| ID | Incidencia | Resultado |
|---|---|---|
| I1 | Packing sin datos de compra | **21 filas** con F=$2.83 pero cantidad/costo vacíos (F68–F87 aprox.) |
| I2 | Errores de fórmula `#DIV/0!` | **81 celdas** (E68–E87 y sus columnas derivadas J/K/L; también E178). Numbers los cachea como `t="str"` — el ensayo detecta ambas serializaciones |
| I3 | Productos duplicados | **1 par** de nombres normalizados idénticos |
| I4 | Cantidad > 0 sin costo | 0 filas (los costos faltantes se manifestaron como I1/I2, no como costo cero) |
| I6 | Factores de reparto en fórmulas | `0.15×22, 0.5×22, 0.35×21` — **confirma 15/50/35 en Inventario** |

### Ventas Ago - Sep

| ID | Incidencia | Resultado |
|---|---|---|
| V1 | Subtotal incompleto | **K28 difiere en $60.13** de la suma real K12:K27 — reproduce exactamente el hallazgo documental, ahora con cálculo reproducible |
| V2 | Meses mezclados | Celdas de fecha en 2026-08 (2) y 2026-09 (6); el conteo es de **celdas con valor**, no pedidos (las fechas viven en celdas combinadas por bloque) |
| V3 | Factores de reparto | `0.2×9, 0.5×9, 0.3×9` — **confirma 20/50/30 en ventas** |
| V4 | Cantidad > 1 | **7 renglones** (F48, F51…) — semántica Precio/Costo por-línea vs unitario a confirmar (D14) |

### Ventas Oct

| ID | Incidencia | Resultado |
|---|---|---|
| O1 | Estatus de pago | **18 PAGADO / 4 NO PAGADO** (celdas sin estatus no cuentan pedidos completos) |
| O2 | Ganancia calculada en NO PAGADO | 1 bloque (P22, con fórmulas L:O) — el reparto no depende del cobro (D04) |
| O3 | Cantidad > 1 | **3 renglones** (F13, F27, F37) |
| O3b | Packing de octubre | **28 filas con $1 por pieza** (J5–J32 aprox.) y algunas sin valor |
| V2 | Meses | Solo 2026-10 ✓ |

## Hallazgos para la sesión de decisiones

1. **La regla de empaque de OLI-016 ya vive en el Excel de octubre:** Packing = $1 por
   pieza en 28 filas. La entrevista y la hoja coinciden; falta confirmar si el $1 es por
   pieza siempre y el tratamiento de la bolsa exterior por pedido (D07).
2. **15/50/35 (Inventario) vs 20/50/30 (ventas) confirmado por fórmulas** en ambos casos.
   La regla vigente ya confirmada es 20/50/30; el 15/50/35 aparece sólo en el inventario.
3. **El gap de $60.13 (V1) es reproducible** y proviene de un rango de SUM mal escrito;
   el total general K93 no depende de K28. No importar subtotales como verdad.
4. **#DIV/0! en 81 celdas**: la hoja no distingue "costo desconocido" de "error"; en Store OS
   el costo desconocido debe ser `undefined` visible, nunca cero ni error (principio ya
   implementado en `weightedAverageCost`).
5. **Las fechas cuentan celdas, no pedidos**: los bloques combinados por clienta no tienen
   identificador estable — la migración (E9) deberá reconstruir pedidos por bloque y resolver
   deduplicación de nombres (I3 en productos; V5 en clientas).
6. **El estatus de pago de octubre (18/4)** es el insumo directo para la migración de
   `opening_balance` (E4): los NO PAGADO documentados P22–P25 son 4 pedidos/filas.
