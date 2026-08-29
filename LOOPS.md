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
7. El humano revisa y hace merge. Fin.

## Backlog

`docs/backlog.json` es la lista viva de items (dato, sin gating). El flujo de ideas sigue en [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Límites que se mantienen

- Un agente nunca: mergea un PR, hace push a `main`, despliega producción, ni lee/escribe datos productivos.
- Nunca `firebase deploy --only ...` desde el agente; CI despliega Preview/Production.
- Producción (`store-os-f7cf8`) intocable: siembra y pruebas solo en `store-os-dev`.
- Tests, aislamiento multitienda y la restricción de cero costos no se flexibilizan para bajar un PR.
