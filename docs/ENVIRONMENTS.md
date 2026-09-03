# Ambientes y ciclo de entrega

Este documento es la fuente única para saber dónde corre Store OS. Si otro
documento contradice esta tabla, este contrato tiene prioridad y el documento
contradictorio debe corregirse.

| Ambiente | Aplicación | Firebase | Propósito |
| --- | --- | --- | --- |
| Desarrollo local | `npm run dev` en `localhost:5173` | `store-os-dev` | Escribir, probar y depurar contra el backend real de desarrollo |
| Preview | URL temporal de Vercel | `store-os-dev` | Validación de aceptación con el mismo backend dev |
| Producción | URL pública | `store-os-f7cf8` | Operación real |

Localhost no es una aplicación sin backend ni una copia ficticia. Debe usar
Auth, Firestore, Storage y Functions reales de `store-os-dev`. La configuración
ausente, incompleta o cruzada bloquea el arranque; nunca activa otro origen de
datos.

## Promoción SDLC

El flujo es lineal y obligatorio:

```text
commit/branch → localhost + store-os-dev → Preview + store-os-dev → producción
                                                       ↑ aprobación explícita
```

El mismo commit promueve código y estructura (reglas, índices, Storage y
Functions). Los datos de prueba sólo viven en `store-os-dev`; nunca se copian a
producción.

## Pruebas

Las pruebas unitarias verifican lógica pura. Las pruebas de integración, reglas,
Functions y navegador que necesiten Firebase se ejecutan contra el proyecto
real `store-os-dev`, escribiendo datos temporales reales y limpiándolos al
finalizar. Requieren ADC de Google Cloud o el secreto externo
`FIREBASE_DEV_SERVICE_ACCOUNT_JSON`; no se usa un backend alterno para declarar
una prueba verde.

## Guardas

- Localhost y Preview requieren `VITE_FIREBASE_PROJECT_ID=store-os-dev`.
- Producción requiere `VITE_FIREBASE_PROJECT_ID=store-os-f7cf8`.
- Las seis variables `VITE_FIREBASE_*` son obligatorias en todos los builds.
- `VITE_FIREBASE_EMULATOR` no es una variable válida.
- `npm run deploy:dev` sólo puede desplegar a `store-os-dev`.
- El seed/republicación de catálogo sólo puede escribir en `store-os-dev`.

Antes de probar el catálogo, despliega la estructura y la callable al proyecto
dev y ejecuta el seed/republicación para que cada resumen público tenga
`productId` y `availableQuantity`.
