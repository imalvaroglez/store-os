# Ledger de integración financiera — estado vigente

> #171 — Vista actual y comprobable de qué cambios financieros están listos para integrarse, qué depende de una decisión de negocio y cuál es el orden seguro de revisión. **Documento de coordinación**: no implementa nada; cada cambio conserva su issue/PR y compuertas. **Corte: 2026-11-14 20:35 UTC** (día y hora exactos: este tablero se mueve por horas — refrescar esta sección contra el tablero/PRs inmediatamente antes de cualquier merge que la use); el estado de verdad vive en las issues enlazadas.

## A. Decisiones confirmadas (fuente y efecto)

| Decisión | Fuente | Efecto |
|---|---|---|
| Cierre/reparto arrancan en T0 sin conciliación histórica de Excel | #129 (cuerpo vigente) | La vista previa no precarga saldos; «sin dato» ≠ 0 |
| Reparto 50/30/20 vigente hasta cambio explícito; nunca 50/50 al recuperar principal | #128 | La simulación usa 50/30/20 con centavo por mayor residuo (Fer→Olivia→inversionista) |
| Pérdida operativa se compensa antes del máximo distribuible | #128 | Base por resultados = max(0, resultado − pérdida acumulada) |
| Ranking de emprendedoras: neto entregado del mes CDMX; desempate por piezas; empate persistente lo resuelve Fer | #132 | Cálculo FER-17; participantes solo `segment=entrepreneur` |
| Validación de Fer del primer cierre real es compuerta explícita antes de cerrar/repartir de verdad | #129/#128 | Las etapas entregadas son de solo lectura; nada autoriza repartos reales |
| Crédito a favor solo mediante operaciones firmadas y trazables | #380 (PO, en curso) | PR #403 + prototipo #413 esperan decisión del PO |

## B. Trabajo técnico ejecutable / en revisión (PRs abiertos con CI verde)

| # | PR | SHA | Issue | Contenido | Estado |
|---|---|---|---|---|---|
| 1 | #410 | `5db6a22` | #365 | Alertas de reabasto leen el agregado de colores | CI ✓; revisión: APROBADO (2 revisores) — Por liberar |
| 2 | #412 | `258ec54` | #364 | Incidencias mueven el estante del color exacto | CI ✓; revisión: APROBADO (2 revisores) — Por liberar |
| 3 | #414 | `96f5526` | #369 | Cancelado no admite cobros (3 capas) | CI ✓; código APROBADO; UX BLOQUEADO por criterio 3 (decisión PO) |
| 4 | #415 | `1912d1d` | #368 | La línea con incidencia es evidencia (guard + insignia) | CI ✓; revisión: APROBADO (2 revisores) — Por liberar |
| 5 | #416 | `0703c8e` | #373 | Parches vs clones vencidos (membresías/productos/compras) | CI ✓; rondas 1-2 BLOQUEADAS → **ronda 3 APROBADO (código+UX)** — Por liberar |
| 6 | #417 | `a008d57` | #374 | Anti-squatting en proyecciones públicas | CI ✓; ronda 1 BLOQUEADA → **ronda 2 APROBADO (código+UX)** — Por liberar |
| 7 | #418 | `ac84ae2` | #371 | Pausa «Agotado» honrada en catálogo genérico | CI ✓; sin revisión (base de #434) |
| 8 | #434 | `8834769`+`6917ec0` | #135+#137 | Encargo + filtro acabado + selector de variantes GANNI | CI ✓; **apilado sobre #418** (fusionar #418 primero) |
| 9 | #419 | `3482622` | #129 etapa | Vista previa de cierre mensual (solo lectura) | CI ✓; ronda 1 BLOQUEADA (CRÍTICO mes-frontera + MAYOR cobros) → ronda 2 BLOQUEADA → **ronda 3 APROBADO (código+UX, compuertas A-D del PO en verde)** — Por liberar |
| 10 | #431 | `46ffb96` | #128 etapa | Reparto propuesto 50/30/20 (simulación) | CI ✓; sin revisión |
| 11 | #436 | `30ce435` | #132 FER-17 | Top emprendedoras (neto entregado) | CI ✓; código APROBADO; UX r1 BLOQUEADO → **corregido en r2**; espera re-revisión UX |
| 12 | #435 | `ac33da4` | #421 | Renglón sin ficha: aviso + vínculo con precio acordado | CI ✓; revisión: APROBADO (2 revisores) — Por liberar |
| 13 | #438 | `6600971` | #211 fase 1 | Asociación proveedor-código → producto | CI ✓; ronda 1 BLOQUEADA (LIST cross-tenant) → **corregido en r2**; espera re-revisión |
| 14 | #428 | `7795704` | #359 | SW fuera de /catalogo + REST no-store + logo versionado | CI ✓; revisión: APROBADO — Por liberar |
| 15 | #430 | `682e822` | #386 | Espera e2e tolera escritura en background | CI ✓; revisión: APROBADO — Por liberar |
| 16 | #432 | `6a5ea96` | #191 fase 1 | `npm run usage-report` (local, privado) | CI ✓; ronda 1 BLOQUEADA (2 MAYOR) → **corregido en r2**; espera re-revisión |
| 17 | #433 | `e844ad9` | #195 | Guía de fotografía (documento) | CI ✓; sin revisión; piloto requiere material de Fer |
| 18 | #411 | `c865cb7` | #406 | Totales animados nunca en $0 | CI ✓; sesión 2 |
| 19 | #403 | `12742e9` | #380 | Reglas: crédito solo con operaciones firmadas | CI ✓; **congelado a decisión PO** |
| 20 | #413 | — | #380 | Prototipo applyCredit/releaseCredit | CI ✓; **congelado a decisión PO** |

Documentario: #397/#401 (runbook Sev-1 §6) esperan revisión del PO — sin impacto en el tren financiero.

## C. Condiciones de negocio pendientes (quién resuelve y qué desbloquea)

| Condición | Responsable | Desbloquea |
|---|---|---|
| Devolución de dinero ya recibido en pedidos cancelados (criterio 3 de #369; opciones A/B ya planteadas) | PO | Cerrar #414/#369 en su totalidad; #202 define las correcciones de cierre |
| Crédito a favor: destino de la operación de confianza (callable vs reglas puras) | PO | Merge de #403/#413; desbloquea #366/#367/#383 |
| Validación de Fer del primer cierre real (con la vista previa de #419) | Fer (vía PO) | Etapa operativa de #129; habilita #202/#279 contra datos reales |
| Confirmar la receta fotográfica y ejecutar el piloto | Fer | Publicación de la guía #195 al catálogo |
| Revisión del ranking por Fer al cierre de mes | Fer | Confirmación definitiva del top (#132 etapa operativa) |

## D. Orden de integración propuesto (dependencias y conflictos reproducibles)

1. **#410 (#365)**, **#412 (#364)**, **#415 (#368)**, **#416 (#373 r3)**, **#417 (#374 r2)**, **#428 (#359)**, **#430 (#386)**, **#433 (#195)**, **#435 (#421)** — todos con doble veredicto APROBADO y CI verde; sin solape entre sí. Integrables ya (r1 de #415 ya estaba publicada al corte original — corregido).
2. **#418 (#371)** primero y **#434 (#135+#137)** después — apilados por diseño (misma pantalla); #434 declara la dependencia. Ambos aprobados.
3. **#419 (#129 etapa, r3)** y **#431 (#128 etapa)** — aprobados, solo lectura, independientes; #436 (#132) los alcanza cuando su re-revisión UX apruebe.
4. **#432 (#191 r2)** y **#438 (#211 r2)** — correcciones publicadas con evidencia; esperan re-revisión. Integrar #416 antes de #438 sigue reduciendo el riesgo en `PurchaseForm` (ambos editan guardados de compra).
5. **#414 (#369)** — el eje código ya está aprobado; la compuerta es la decisión del PO (criterio 3). Integrar el código no depende de esa decisión, pero el cierre de la issue sí.
6. **#411 (#406)** — sesión 2; independiente del tren financiero (veredicto en su PR).
7. **#403/#413 (#380)** y su cola (#366/#367/#383) — bloqueados por la decisión del PO; ninguna otra historia debe tocar `credit*` mientras tanto.

## E. Disponibilidad real (qué ve Fer hoy)

- **En main/producción (1.16.2, liberada el 2026-11-14 vía hotfix #429 — horas antes del corte original de este ledger)**: pedidos/cobros/entregas/incidencias por color (#333/#353/#391/#394/#398/#399/#404/#405/#429), compras por ticket con recepción (#206/#207), precio por clienta (#151), estrategia de precios (#289/#315).
- **Solo en PR (propuesta)**: todo lo de la sección B — cierre mensual y reparto son **simulaciones de solo lectura**; ninguna cifra se autoriza ni se mueve desde ellas.
- **Sin implementar**: #202 (correcciones de cierre), #279 (caja/obligaciones), operación de crédito firmada (#380), etapas operativas de #128/#129/#132.

## F. Defectos nuevos

Ninguno detectado durante esta revisión que no tenga issue propia. (El hallazgo de reglas legado sin `status` en compras fue corregido dentro de #416 ronda 2 con su prueba.)
