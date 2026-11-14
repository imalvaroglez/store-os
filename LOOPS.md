# Store OS — Flujo de entrega

Política vigente tras eliminar el delivery harness como gate (ver `docs/adr/0002-remove-delivery-harness-ceremony.md`). La filosofía de los loops (validar antes de declarar "done") vive en [`docs/LOOPS.md`](docs/LOOPS.md).

## Un cambio, una rama, un PR

1. Rama nueva desde `main`.
2. Implementa el cambio. Si escribes spec, vive en `docs/superpowers/specs/` y viaja **dentro** del mismo PR del código.
3. Tests primero cuando aplique: escribe el test, míralo fallar, implementa hasta verde.
4. Verde obligatorio antes de abrir el PR:

   ```bash
   npm run typecheck && npm run test && npm run build
   ```

5. **Doble revisión independiente por issue implementada:** cuando el autor considera terminado el cambio, lanza dos subagentes distintos, read-only y sin contexto previo: (a) code review de lógica, datos, seguridad y regresiones; (b) **UX review como misión de operadora** — un objetivo concreto de negocio ejecutado de principio a fin sin instrucciones del autor, en navegador local/dev con volumen representativo (móvil y escritorio cuando aplique), con el informe mínimo y la regla de BLOQUEADO por esfuerzo manual evitable definidos en AGENTS.md (mandato del PO 2026-11-09). Los revisores leen issue + diff/PR + guías y contexto técnico mínimo, reportan veredictos/evidencia propios y no heredan conclusiones del autor. Para trabajo sin interfaz el revisor UX justifica NO APLICA o evalúa impacto indirecto; si no puede comprobar un flujo afectado, la validación queda pendiente. Hallazgos críticos/mayores o fricción significativa en un flujo central bloquean el merge hasta corregir y repetir las revisiones pertinentes. El PR documenta su validación UX (objetivo, recorrido, volumen, veredicto). Ver AGENTS.md, CLAUDE.md y docs/DESIGN.md.
6. Abre **draft PR** hacia `main`; espera CI (`build-test` + `rules-and-e2e`) y el deploy de Preview.
7. Merge: lo hace el humano, o el agente bajo la autorización permanente del
   PO (2026-11-08) — en ambos casos tras CI completo en verde y revisión
   independiente sin hallazgos abiertos. La historia de producto pasa a Por liberar.
8. El release a producción puede autorizarlo una persona o ejecutarlo el agente
   bajo esa misma autorización, siempre con versión incrementada y notas
   (release guard) y verificación del deploy. Cada release genera además el
   mensaje para Fer con la plantilla de `docs/releases/notas-para-fer.md` y lo
   incluye en el cuerpo del PR de release. La liberación cierra la historia:
   se registran commit y versión liberada en la issue y pasa a Hecho, sin ronda
   adicional de aceptación. Defectos o ajustes posteriores nacen como items
   nuevos. El trabajo operativo cierra con su entregable concreto registrado.

## Backlog

La lista viva es el tablero "Store OS" de [GitHub Projects](https://github.com/users/imalvaroglez/projects/1):
una issue por capacidad con criterios de aceptación, y campos Status (estado en español) / Prioridad /
Tipo / Ciclo. Los agentes lo consultan y actualizan con `gh project` / `gh issue`.
Al iniciar: consultar la issue y sus dependencias. Al abrir el draft PR, enlazar
la issue y moverla a En PR. Usar `Refs #N` mientras una historia de producto espera su liberación.
No cerrarla automáticamente al merge. El README del tablero define Listo, los
responsables, el trabajo en paralelo y la evidencia por tipo de entrega; prevalece
sobre los antecedentes. No abrir PRs para registrar feedback o mover el backlog.

El contexto de descubrimiento (entrevistas, diagnóstico, plan de acción) sigue en
[`docs/BACKLOG.md`](docs/BACKLOG.md); ningún documento del repo registra estados.

## Límites que se mantienen

- Un agente nunca: hace push directo a `main` (solo merge de PR) ni lee/escribe datos productivos. Merge de PRs y liberación a producción están autorizados de forma permanente (PO, 2026-11-08) bajo CI completo en verde + revisión independiente sin contexto + release guard.
- Nunca `firebase deploy --only ...` desde el agente; CI despliega Preview/Production.
- Producción (`store-os-f7cf8`) intocable: siembra y pruebas solo en `store-os-dev`.
- Los únicos IDs Firebase permitidos son `store-os-dev` para desarrollo y `store-os-f7cf8` para producción; cualquier otro destino bloquea el cambio.
- Desarrollo conectado, pruebas y Preview usan únicamente `store-os-dev`. Los emuladores locales usan el mismo ID y mantienen todos los servicios en `127.0.0.1`; no se crea un proyecto o namespace separado.
- `.firebaserc` debe tener `store-os-dev` como predeterminado. Todo comando Firebase que pueda elegir proyecto declara el destino; nunca se depende de un valor implícito.
- Producción (`store-os-f7cf8`) recibe releases por CI, salvo un parche de aplicación por la [vía directa Sev-1](docs/runbook-sev1-hotfix.md) autorizada expresamente por el PO. Nunca se copian datos de prueba ni seeds desde dev.
- Toda operación administrativa requiere Auth + Firestore. No se admite persistencia administrativa alternativa en `localStorage`; se conservan carrito público, preferencias, borradores autenticados y PWA.
- No se reintroduce el acceso administrativo sin sesión ni el fallback de estado local. La erradicación P0 sigue bloqueada por sus dependencias; el PR #108 debe cerrarse por su responsable y queda excluido de integración.
- Tests, aislamiento multitienda y la restricción de cero costos no se flexibilizan para bajar un PR.
