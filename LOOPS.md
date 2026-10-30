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
- Los únicos IDs Firebase permitidos son `store-os-dev` para desarrollo y `store-os-f7cf8` para producción; cualquier otro destino bloquea el cambio.
- Desarrollo conectado, pruebas y Preview usan únicamente `store-os-dev`. Los emuladores locales usan el mismo ID y mantienen todos los servicios en `127.0.0.1`; no se crea un proyecto o namespace separado.
- `.firebaserc` debe tener `store-os-dev` como predeterminado. Todo comando Firebase que pueda elegir proyecto declara el destino; nunca se depende de un valor implícito.
- Producción (`store-os-f7cf8`) solo se usa después de aprobación humana explícita. No se copian datos de prueba ni seeds desde dev.
- Toda operación administrativa requiere Auth + Firestore. No se admite persistencia administrativa alternativa en `localStorage`; se conservan carrito público, preferencias, borradores autenticados y PWA.
- No se reintroduce el acceso administrativo sin sesión ni el fallback de estado local. La erradicación P0 sigue bloqueada por sus dependencias; el PR #108 debe cerrarse por su responsable y queda excluido de integración.
- Tests, aislamiento multitienda y la restricción de cero costos no se flexibilizan para bajar un PR.
