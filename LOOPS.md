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

5. Revisión con subagentes read-only (code map, diseño de tests, estándares de `store-os-review`, seguridad multitienda) — son consejo, no gate. El gate real es CI + el humano que hace merge.
6. Abre **draft PR** hacia `main`; espera CI (`build-test` + `rules-and-e2e`) y el deploy de Preview.
7. El humano revisa y hace merge. La historia de producto pasa a Por liberar.
8. Una persona autoriza explícitamente el commit a liberar. Tras la liberación y
   verificación del resultado, se registra evidencia y se cierra como Hecho.
   Operaciones y herramientas internas se aceptan por su entregable concreto.

## Backlog

La lista viva es el tablero "Store OS" de [GitHub Projects](https://github.com/users/imalvaroglez/projects/1):
una issue por capacidad con criterios de aceptación, y campos Status (estado en español) / Prioridad /
Tipo / Ciclo. Los agentes lo consultan y actualizan con `gh project` / `gh issue`.
Al iniciar: consultar la issue y sus dependencias. Al abrir el draft PR, enlazar
la issue y moverla a En PR. Usar `Refs #N` mientras una historia de producto espera liberación/aceptación.
No cerrarla automáticamente al merge. El README del tablero define Listo, los
responsables, el trabajo en paralelo y la evidencia por tipo de entrega; prevalece
sobre los antecedentes. No abrir PRs para registrar feedback o mover el backlog.

El contexto de descubrimiento (entrevistas, diagnóstico, plan de acción) sigue en
[`docs/BACKLOG.md`](docs/BACKLOG.md); ningún documento del repo registra estados.

## Límites que se mantienen

- Un agente nunca: mergea un PR, hace push a `main`, despliega producción, ni lee/escribe datos productivos.
- Nunca `firebase deploy --only ...` desde el agente; CI despliega Preview/Production.
- Producción (`store-os-f7cf8`) intocable: siembra y pruebas solo en `store-os-dev`.
- Los únicos IDs Firebase permitidos son `store-os-dev` para desarrollo y `store-os-f7cf8` para producción; cualquier otro destino bloquea el cambio.
- Desarrollo conectado, pruebas y Preview usan únicamente `store-os-dev`. Los emuladores locales usan el mismo ID y mantienen todos los servicios en `127.0.0.1`; no se crea un proyecto o namespace separado.
- `.firebaserc` debe tener `store-os-dev` como predeterminado. Todo comando Firebase que pueda elegir proyecto declara el destino; nunca se depende de un valor implícito.
- Producción (`store-os-f7cf8`) solo se usa después de aprobación humana explícita. No se copian datos de prueba ni seeds desde dev.
- Toda operación administrativa requiere Auth + Firestore. No se admite persistencia administrativa alternativa en `localStorage`; se conservan carrito público, preferencias, borradores autenticados y PWA.
- No se reintroduce el acceso administrativo sin sesión ni el fallback de estado local. La erradicación P0 sigue bloqueada por sus dependencias; el PR #108 debe cerrarse por su responsable y queda excluido de integración.
- Tests, aislamiento multitienda y la restricción de cero costos no se flexibilizan para bajar un PR.
