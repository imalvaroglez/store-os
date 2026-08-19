---
Delivery-ID: pnpm-lockfile
Delivery-Status: Approved
Approved-By: Álvaro González (PO)
specPath: docs/superpowers/specs/pnpm-lockfile-design.md
---

# Diseño: Resolver el lockfile de pnpm

Item de cola: `pnpm-lockfile` (docs/BACKLOG.md:111-114).

## Problema (causa raíz verificada en código)

El repositorio lleva **dos lockfiles**: `package-lock.json` (npm, 246K, fuente de
verdad) y `pnpm-lock.yaml` (111K). Hechos verificados:

- `pnpm-lock.yaml` entró al repo en el commit `9a3c901` ("Install Vercel Speed
  Insights with docs") y **sigue trackeado en `origin/main`** hoy
  (`git ls-tree origin/main` lo lista).
- `package.json` **no** declara campo `packageManager`: ninguna señal le dice a
  Vercel/Corepack qué toolchain usar, así que la detección cae al lockfile.
- `.gitignore` tiene una sección `# pnpm` (líneas 128-129) pero solo ignora
  `.pnpm-store`; **no** ignora `pnpm-lock.yaml`, por eso puede re-entrar.
- CI (`.github/workflows/ci.yml`) usa npm en todos los jobs (`cache: "npm"` +
  `npm ci`, líneas 87-88 y 115-116).
- `vercel.json:6` fija `"installCommand": "npm install"`, lo cual mitiga, pero
  Vercel sigue detectando pnpm por el lockfile para versiones de Node/corepack
  y pasos fuera de `installCommand`; y cualquier persona/agente que corra
  `pnpm install` localmente regenera el archivo sin que nadie lo note.

Riesgo concreto: builds de Vercel con un árbol de dependencias distinto al de
local/CI, fallos de build "fantasma" que no se reproducen con npm.

Nota: existe ya la rama no fusionada `delivery/pnpm-lockfile` con el commit
`053ff68` que implementa exactamente este alcance (borrado + gitignore). El
implementador puede reutilizarla o rehacerla; la spec conserva el mismo alcance.

## Objetivo

Un solo toolchain (npm) en todos los ambientes, sin posibilidad de que
`pnpm-lock.yaml` reaparezca silenciosamente.

## Alcance

**In:**
1. `git rm pnpm-lock.yaml` (solo borrar el archivo trackeado).
2. Agregar `pnpm-lock.yaml` a la sección `# pnpm` de `.gitignore`.

**Out (YAGNI):**
- No agregar campo `packageManager` a `package.json` — con un solo lockfile y
  `installCommand` fijo no hay ambigüedad que resolver. `ponytail:` si algún día
  reaparece el problema, se agrega.
- No migrar a pnpm.
- No tocar `package-lock.json`, `vercel.json`, workflows ni dependencias.

## Diseño

Diff mínimo, dos archivos:

```diff
# .gitignore (sección # pnpm existente, línea ~129)
 .pnpm-store
+pnpm-lock.yaml
```

```bash
git rm pnpm-lock.yaml
```

Sin cambios de código, sin cambios de UI, sin migraciones. `npm ci` y
`npm install` son idempotentes respecto a este cambio: `package-lock.json`
queda intacto, así que el árbol de dependencias no cambia en ningún ambiente.

## Criterios de aceptación

1. `git ls-files | grep pnpm-lock` no regresa nada en la rama del delivery.
2. `.gitignore` contiene `pnpm-lock.yaml`.
3. `npm ci && npm run typecheck && npm run build && npm test` pasan (verificación
   del harness).
4. El diff toca exactamente 2 rutas: `pnpm-lock.yaml` (borrado) y `.gitignore`.
5. El build de Preview en Vercel es verde con npm (sin detección de pnpm).

## previewChecks

```json
[
  { "path": "/", "selector": "body", "text": "Entrar" }
]
```

(Verificación de humo de que la app sigue arrancando tras el cambio de toolchain.)
Nota: la rama del PR #26 (cerrado, sin merge) contiene la implementación de este
alcance; puede rescatarse tras aprobar esta spec, previa revisión contra este diseño.

## Riesgos

- **Ninguno funcional.** No hay cambio de código ni de dependencias; el riesgo
  es cero para datos y aislamiento.
- **Riesgo menor:** alguien con pnpm como gestor por defecto regenera el archivo
  localmente; `.gitignore` lo mantiene fuera del repo. Si eso duele en algún
  momento, el campo `packageManager` es el siguiente paso (fuera de alcance).
- **Riesgo de proceso:** la rama vieja `delivery/pnpm-lockfile` puede confundir;
  el implementador debe partir de `main` actual y cherry-pick/rehacer, no
  reutilizar la rama tal cual (puede estar desactualizada).
