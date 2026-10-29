# E0 — Ensayo del Excel, reglas de apertura y paquete de decisiones

**Fecha:** 2026-10-28 · **Estado:** implementándose · **Entregas:** Ciclo 1 (E0) del
[plan técnico aprobado](../../../.claude/plans/act-a-como-l-der-t-cnico-velvety-castle.md)
· **Historias:** preparación de OLI-035 + base de todas.

## Problema

El modelo financiero de Store OS (E4–E9) debe absorber la semántica real del Excel de Fer
(`Ventas .xlsx`: hojas `Inventario`, `Ventas Ago - Sep`, `Ventas Oct`). El análisis
documentado ([`fer-excel-analysis-2026-10-28.md`](../fer-excel-analysis-2026-10-28.md))
describe hallazgos puntuales, pero no existe un proceso reproducible que verifique el
archivo real ni un paquete de decisiones cerrado para la sesión con Fer. Construir el
modelo financiero sin esa evidencia arriesga descubrir incompatibilidades tarde.

## Objetivo

1. **Micro-ensayo reproducible y solo-lectura** del Excel real que genere un reporte de
   incidencias verificable (y anonimizable) — primer paso operativo de OLI-035.
2. **Reglas de apertura** documentadas como preguntas concretas (fecha oficial, stock,
   saldos, abonos sin fecha) — insumo de la sesión con Fer.
3. **Paquete de decisiones D01–D15** (reformulado: no reabre lo confirmado) listo para Fer.
4. **Inicio de la investigación de canal de avisos** (D12) con evidencia.
5. `docs/ARCHITECTURE.md` actualizado al estado real del sistema (riesgo R9 del plan).

## Diseño

### Parser sin dependencias nuevas

- Script `scripts/excel-trial-report.cjs`: CLI `node scripts/excel-trial-report.cjs <xlsx> [--out <dir>]`.
- Un `.xlsx` es un ZIP de XML: se extrae con `unzip` del sistema a un directorio temporal
  y se parsea a mano (`workbook.xml` → nombre de hoja → archivo; `sharedStrings.xml`;
  `sheetN.xml`). **Cero dependencias nuevas** (política de costo/suministro).
- Funciones puras exportadas (testeables con fixtures XML mínimos, patrón
  `backfill-public-product-store-ids`):
  - `parseSharedStrings(xml)` → `string[]` (concatena rich-text `<t>`).
  - `parseSheet(xml, shared)` → `{ cells: Map<"A1", {value, formula, type}>, merges, dims }`.
  - Detectores por hoja (ver incidencias).
- El archivo fuente **nunca se modifica** (solo lectura; se verifica en test de humo que
  el script no escribe en la ruta de origen).

### Incidencias a detectar (checklist verificable contra el análisis previo)

| ID | Hoja | Incidencia | Detalle esperado (del análisis) |
|---|---|---|---|
| I1 | Inventario | Packing sin compra | Filas con F=2.83 y C/D vacíos (164 filas en F5:F176) |
| I2 | Inventario | Errores `#DIV/0!` | E68:E87 divide entre C vacío; también E178 |
| I3 | Inventario | Productos duplicados | Nombres normalizados repetidos |
| I4 | Inventario | Costo cero/vacío con cantidad>0 | Dato incompleto ≠ costo cero |
| I5 | Inventario | Fila de totales con base confusa | J178 suma packing+precios; M/N reparten esa base; O usa K vacío |
| I6 | Inventario | Reparto 15/50/35 | Fórmulas M:U divergen del 20/50/30 vigente |
| V1 | Ago-Sep | Subtotal incompleto | K28=SUM(K23:K27) omite K12:K22; diferencia esperada $60.13 |
| V2 | Ago-Sep | Dos meses en una hoja | Fechas ago/sep mezcladas + "TOTALES DEL MES" consolidado |
| V3 | Ago-Sep | Reparto 20/50/30 por fila | Fórmulas K:M consistentes (evidencia a favor) |
| V4 | Ambas ventas | Cantidades>1 con importe total de línea | H48=65*5: semántica de Precio/Costo a confirmar |
| V5 | Ambas ventas | Clientas duplicadas/variantes | Nombres en celdas combinadas, sin id estable |
| O1 | Oct | Estatus de pago | PAGADO / NO PAGADO / vacío (conteo por valor) |
| O2 | Oct | Ganancia calculada en NO PAGADO | L:O calculan reparto sin condición de pago |
| O3 | Oct | Packing adicional | Valores ≠ 2.83 en columna Packing de octubre |
| O4 | Oct | Sin fila de corte total | No existe total de mes en la hoja |

### Salidas y privacidad

- `--out <dir>` (default `./excel-trial-out/`): `report.json` (completo, con nombres tal
  cual — **no se commitea**) y `summary.md` (anonimizado, commiteable como evidencia).
- Anonimización en `summary.md`: clientas → inicial + hash corto (FNV-1a) del nombre;
  nombres de producto sí se incluyen (el catálogo ya es público); sin teléfonos.
- `docs/excel-trial-2026-10-28.md`: resumen interpretado del ensayo real (evidencia E0).

### Decisiones y reglas de apertura (docs nuevos)

- `docs/olivia-decisiones-fer-2026-10-28.md`: una sección por decisión D01–D15 con estado
  (✅ resuelto / ⏳ pendiente), opciones y recomendación técnica. D05 reformulado alrededor
  del saldo del préstamo (la naturaleza del 20% —pago de la inversión— ya está confirmada).
  Incluye las 4 preguntas de apertura (§3.5 del plan) y el anexo de investigación D12.
- `docs/ARCHITECTURE.md`: reescrito al estado real (Auth/Firestore/Functions/Vercel,
  proyecciones públicas, ambientes dev/prod, colecciones vigentes).

## Criterios de aceptación

1. `node scripts/excel-trial-report.cjs "$HOME/Desktop/Ventas .xlsx"` corre en verde y
   genera `report.json` + `summary.md`; el `.xlsx` queda byte-idéntico (hash antes/después).
2. El reporte real detecta las incidencias I1–O4 del checklist (o reporta explícitamente
   cuáles no aplican y por qué) — cada una con referencias de celda.
3. Tests unitarios de parser y detectores con fixtures XML mínimos, en verde
   (`npm run test`).
4. `npm run typecheck && npm run test && npm run build` en verde.
5. `summary.md` no contiene nombres completos de clientas (verificado por el propio script).
6. Docs de decisiones + ARCHITECTURE.md actualizados en el mismo PR.

## Fuera de alcance

- Escribir cualquier cosa en Firestore/Storage (local, dev o prod).
- Migrar datos; el ensayo es solo-lectura y su mapeo se diseñará en E9.
- El baseline de producto con Fer (E0-d) y la sesión de decisiones: pendientes del PO;
  el paquete queda listo para esa sesión.
- Resolver D12 por completo: solo investigación inicial con evidencia.
