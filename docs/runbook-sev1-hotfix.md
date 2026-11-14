# Runbook: vía urgente Sev-1 (contención, hotfix y verificación)

La vía directa existe para restablecer una operación crítica durante un Sev-1. El PO declara el incidente y autoriza explícitamente la publicación directa. La vía ordinaria y el reuso de CI de #227 siguen disponibles.

## 1. Declarar el incidente

Solo el PO declara un Sev-1. Umbral: corrupción/pérdida activa de datos
financieros o existencias, cobro o saldo indebido causando operaciones
incorrectas, exposición de datos, o bloqueo de una operación crítica de venta o atención sin
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

### Vía directa autorizada (parche de aplicación)

1. Identifica el despliegue activo y su commit. Crea un worktree sobre ese commit y registra la autorización, la operación bloqueada y el resultado esperado en la issue. Conserva el ID del despliegue previo para volver a él.
2. Reproduce el fallo con datos sintéticos en local. Aplica el cambio mínimo y comprueba que la regresión falla antes y pasa después. Usa emulador si el flujo toca Auth, Firestore, cobros o existencias. Si el fallo no se reproduce, registra qué evidencia falta y elige una contención que puedas verificar.
3. Comprueba que el parche es compatible con las reglas, índices y esquema que ya están en producción. Si necesita cambiar alguno, usa el flujo de CI correspondiente. No leas ni escribas datos de producción desde desarrollo.
4. Incrementa la versión y añade notas. Haz el build de producción con la configuración verificada de Vercel/Firebase y ejecuta el guard de liberación contra la versión servida. Sube el build como producción sin asignar dominio (`vercel deploy --prebuilt --prod --skip-domain`). Verifica la versión y el despliegue candidato y promuévelo (`vercel promote <deployment> --yes`). Si usas una credencial temporal para verificar el candidato, retírala al acabar. No copies datos ni respaldos a Vercel.
5. Comprueba la versión en el dominio público y pide a la operadora que reintente su tarea conservando el borrador. Si la comprobación falla, vuelve al despliegue previo identificado y registra el resultado.
6. Registra commit, versión, despliegue y evidencia. Abre o actualiza el PR que incorpora el parche a `main`. Incorpóralo antes de cualquier otra publicación que pudiera retirar la corrección. La integración sigue las revisiones del repositorio.

Ejemplo: #391, versión 1.15.3. Se reprodujo el rechazo al sustituir colores de una ficha borrada, se publicó sobre la 1.15.1 y la operadora pudo guardar el pedido existente.

### Reuso de CI cuando el commit exacto ya está probado

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

## 5. Casos de prueba a partir de respaldos

Usa el respaldo cifrado y verificado solo como referencia local autorizada. Antes de preparar un fixture, anota qué relaciones provocan el fallo (por ejemplo, un pedido que apunta a una ficha eliminada y dos fichas nuevas). Reconstruye esas relaciones con IDs, nombres, claves, fechas e importes sintéticos. Conserva las condiciones de negocio que afectan la reproducción, como cantidad, estado, variante y existencia; excluye nombres reales, contactos, cuentas, notas, imágenes, referencias privadas y credenciales.

Revisa los campos del fixture con una lista de lo que se necesita para la prueba. Comprueba que reproduce el rechazo y que el parche lo resuelve en `store-os-dev` con servicios en localhost. Solo el fixture sintético y su prueba van a Git o CI. El respaldo y sus extractos permanecen fuera de Git, CI y servicios externos.

## 6. Ensayo (a ejecutar tras integrar este cambio)

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
