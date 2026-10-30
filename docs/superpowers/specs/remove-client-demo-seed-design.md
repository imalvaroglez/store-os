---
Delivery-ID: remove-client-demo-seed
Delivery-Status: Implemented, pending review
specPath: docs/superpowers/specs/remove-client-demo-seed-design.md
---

# Retirar el seed demo del cliente y conservar el modo local de desarrollo

## Objetivo

No mostrar información sintética como si fueran datos reales y conservar un camino simple para probar la app localmente. El navegador debe iniciar vacío; en `npm run dev`, sin Firebase configurado, la persona puede crear y operar sus tiendas en `localStorage`.

## Reglas de acceso

- El modo local sin sesión solo está disponible cuando `import.meta.env.DEV` es verdadero y Firebase no está configurado.
- Con Firebase configurado, una persona sin sesión siempre ve `AuthScreen`, incluso durante desarrollo. No se usa como fallback ningún estado local guardado.
- En producción, las rutas privadas siempre requieren sesión, aun si faltara la configuración Firebase.
- Las rutas del catálogo público conservan su acceso público y no exponen datos privados.
- La tienda local puede crearse, elegirse, editarse y borrarse. No muestra controles de invitaciones, transferencia de propiedad, edición del sitio público ni publicación de proyecciones cloud.
- El modo local empieza con un `AppState` vacío y persiste mediante el adaptador existente. Los datos sintéticos de Firebase se mantienen en sus flujos separados de desarrollo/emulador.

## Alcance

- Corregir el enrutamiento para respetar simultáneamente el modo local acordado y el acceso autenticado.
- Habilitar administración de tiendas locales y ocultar acciones que solo tienen sentido en cloud.
- Corregir documentación obsoleta que afirmaba que Firebase no existía o que el cliente sembraba tiendas demo.
- Añadir pruebas de primera carga vacía, estado local existente, Firebase configurado sin sesión y build de producción sin sesión.

## Fuera de alcance

- Cambios a Firestore, reglas, proyectos Firebase, seed remoto, permisos o datos de tiendas.
- Restaurar tiendas demo automáticas o añadir datos sintéticos al almacenamiento del navegador.
- Permitir rutas privadas sin sesión en Preview o producción.

## Criterios de aceptación

1. Sin Firebase y con `DEV=true`, una primera visita muestra “Crea tu primera tienda” y puede usar las funciones locales.
2. El almacenamiento local ya existente sigue cargándose en ese modo.
3. Con Firebase configurado y sin sesión, la app muestra `AuthScreen` y no muestra contenido local, también en desarrollo.
4. Con `DEV=false` y sin sesión, la app muestra `AuthScreen`.
5. El selector permite administrar tiendas solo en modo local o según el rol/propiedad en cloud.
6. Las opciones solo-cloud no aparecen en el modo local.
7. No se contacta ni modifica `store-os-dev` o `store-os-f7cf8`; si hacen falta pruebas Firebase, usan únicamente el emulador `store-os-demo`.
8. Pasan typecheck, pruebas unitarias y build.

## Riesgos y límites

- El modo local permite operar datos sin autenticación, por diseño y solo en el servidor Vite de desarrollo sin configuración Firebase. No es una opción de Preview ni de producción.
- El almacenamiento del navegador puede borrarse o quedar aislado por navegador/dispositivo; no sincroniza entre ellos.
