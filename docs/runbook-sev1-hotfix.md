# Runbook: vía urgente Sev-1 (contención, hotfix y verificación)

Referencia operativa de la issue #227. La vía Sev-1 **no elimina compuertas**:
reusa el CI ya probado del mismo commit y conserva el release guard de
versión+notas, el despliegue de reglas con paridad y la verificación post-release.
Sin servicios nuevos de pago: los mismos GitHub Actions + Vercel + Firebase.

## 1. Declarar el incidente

Solo el PO declara un Sev-1. Umbral: corrupción/pérdida activa de datos
financieros o existencias, cobro o saldo indebido causando operaciones
incorrectas, exposición de datos, o bloqueo total de una operación crítica sin
alternativa segura. Un fallo visual es urgente pero no Sev-1 por sí mismo.

Al declarar: una sola issue (la del incidente), un responsable de la
contención, y pausa de features nuevas mientras exista daño activo.

## 2. Contener primero (paralelo al diagnóstico)

- **Contención específica del flujo inseguro** si es más rápida que un release
  (p. ej. deshabilitar el paso afectado). Preferible cuando existe.
- **Rollback de Vercel** solo como contención de la APP: un rollback NO revierte
  Firestore, reglas ni operaciones monetarias — cualquier reparación de datos es
  un cambio separado, exacto y autorizado. La versión inmediatamente anterior
  puede contener el mismo defecto: no presumirla segura.
- Respaldos: verificar el backup reciente ANTES de cualquier reparación.

## 3. El hotfix y su release

1. Un PR mínimo desde `main`: parche + regresión exacta del incidente +
   **versión incrementada y notas** (el release guard de `deploy-rules` sigue
   vigente en la vía Sev-1 — no se omite). Merge con revisión humana.
2. Esperar el CI del push (build-test + rules-and-e2e sobre ese commit).
3. Despachar la vía Sev-1 desde la **punta de main**:

   ```bash
   gh workflow run ci.yml --ref main -f release_production=true -f sev1_reuse_ci=true
   ```

### Qué hace `sev1_reuse_ci` (y qué no)

- `sev1-verify` corre `scripts/check-sev1-ci-reuse.cjs`, que **falla cerrado**
  y solo aprueba el reuso si, para el commit exacto despachado:
  - es la punta actual de `origin/main`;
  - existe una corrida completada y exitosa del workflow CI con evento `push`
    para ese SHA; y
  - esa corrida tiene los jobs `build-test` y `rules-and-e2e` en `success`
    (un push solo-documentación da run verde SIN esas suites: no cuenta).
- Aprobado el reuso, `build-test` y `rules-and-e2e` se saltan y el release
  continúa: `deploy-rules` (con release guard y paridad) y `deploy` (producción).
- Rechazado el reuso (SHA distinto, CI inexistente o fallido, corrida de PR,
  SHA no-punta), el release **no ocurre**: corre las suites o despacha desde la
  punta tras integrar el hotfix.
- Sin `sev1_reuse_ci`, el despacho corre TODO como siempre — la vía normal no
  cambia en nada.

## 4. Verificar y cerrar

- Versión servida (`<meta name="store-os-version">` en la URL de producción),
  actualización de PWA y recorrido crítico (sin perder capturas en curso).
- Señal verificable de que el error cesó (la métrica del incidente).
- Registrar en la issue: tiempos (declaración→contención, aprobación→disponibilidad),
  SHA liberado, versión y evidencia de verificación.

## 5. Ensayo (a ejecutar tras integrar este cambio)

Ensayar en dev con incidentes sintéticos, sin tocar producción:

1. **Guarda pura**: `node scripts/check-sev1-ci-reuse.cjs --self-test` (9 casos:
   camino verde, push doc-only, suite fallida, corrida de PR, SHA no-punta,
   SHA de otro commit, SHA malformado, sin corridas, jobs de otra corrida).
2. **Rechazos del guard en vivo**: despachar `sev1_reuse_ci=true` con un SHA
   sin CI verde (p. ej. recién empujado) → `sev1-verify` debe fallar y NO
   ejecutarse `deploy`/`deploy-rules`.
3. **Aprobación**: tras un push con CI verde, despacho Sev-1 → medir el tiempo
   de aprobación→disponibilidad contra el despacho normal (~12 min de suites
   ahorrados).
4. **Vía normal intacta**: un push normal y un despacho `release_production`
   sin `sev1_reuse_ci` deben correr ambas suites como hoy.
5. **Destino Firebase cruzado**: confirmar que la vía Sev-1 no evade el guard
   de entorno — `check-env.cjs` corre dentro del `vercel build` del deploy con
   los secrets del environment Production, independiente de las suites
   saltadas; un bundle apuntando a `store-os-dev` no puede pasar a producción
   por ninguna vía.
6. Retorno compatible: ensayar el flujo de rollback de Vercel en el entorno de
   preview (elegibilidad del plan, sin contratar nada).

## Fuentes

- Workflow vigente: `.github/workflows/ci.yml`
- Guard: `scripts/check-sev1-ci-reuse.cjs`
- Vercel instant rollback: https://vercel.com/docs/instant-rollback
- Uso seguro de Actions: https://docs.github.com/en/actions/reference/security/secure-use
