# Erradicar persistencia administrativa local

Fecha: 30 de octubre de 2026  
Prioridad: **P0 — bloqueante arquitectónico**  
Estado: **bloqueado por integración de dependencias**

## Objetivo

Store OS debe operar su panel únicamente con una sesión Firebase Auth y datos
administrativos en Firestore. Si Auth o la configuración de Firebase no están
disponibles, la aplicación debe detener la operación administrativa con un
mensaje explícito. Nunca debe cambiar a un estado administrativo guardado en el
navegador.

Flujo único de ambientes:

**Desarrollo → validación con `store-os-dev` → aprobación humana → producción con `store-os-f7cf8`.**

Esta especificación formaliza la Fase B. La preparación documental de Fase A no
elimina aún la ruta de runtime heredada.

## Evidencia de la implementación inspeccionada

- `src/app/firebase/config.ts` exporta `isFirebaseConfigured()`. Si faltan
  variables, `AuthProvider` queda deshabilitado en vez de reportar un error.
- `App.tsx` protege las rutas administrativas sin sesión, pero
  `StoreProvider.tsx` calcula `cloud` con `isFirebaseConfigured() && user` y
  carga `loadState()` cuando esa condición es falsa. También guarda cambios
  administrativos en el navegador por esa rama.
- `src/lib/storage.ts` lee y escribe el `AppState` completo en
  `store_os_state_v1`; ese estado puede conservar datos personales y del negocio
  de una versión anterior.
- Algunas pruebas utilizan configuración Firebase ausente para provocar la
  rama local. Esas pruebas describen un modo de ejecución que debe desaparecer;
  deben migrarse a mocks explícitos.
- El catálogo público ya tiene lectura anónima de proyecciones Firebase. Esa
  funcionalidad no requiere permitir administración sin autenticación.

## Alcance de Fase B

### 1. Configuración obligatoria y arranque

- Validar las variables públicas obligatorias de Firebase al iniciar, antes de
  montar la aplicación y sus rutas públicas o privadas.
- Si falta una variable o el ID de proyecto no corresponde al ambiente, mostrar
  una pantalla de error de configuración y detener el arranque. No inicializar
  un backend alternativo ni interpretar la falta de configuración como una
  sesión anónima válida.
- Desarrollo y Preview usan `store-os-dev`; producción usa
  `store-os-f7cf8` solamente al liberar un cambio aprobado.
- Los emuladores conservan `store-os-dev` como ID lógico y conectan Auth,
  Firestore, Storage y Functions a `127.0.0.1`. Los valores ficticios que el SDK
  exige para emulador se proporcionan desde la configuración de pruebas, no por
  un fallback general de runtime.
- Una configuración válida permite que la ruta `/catalogo/:slug` siga leyendo
  anónimamente las proyecciones públicas. No exige iniciar sesión para consultar
  el catálogo.

### 2. Un solo StoreProvider administrativo

- El estado operativo se hidrata desde Firestore una vez que Auth confirma una
  sesión y se mantiene en memoria para renderizar la interfaz.
- Eliminar la selección entre persistencia local y cloud, la carga de estado
  administrativo local y el efecto que guarda cada cambio en `localStorage`.
- Toda acción administrativa valida una identidad autenticada antes de leer o
  escribir. Si no existe sesión, falla con un error visible y no actualiza un
  almacén local alternativo ni informa éxito.
- Mantener el control contra ecos de snapshots y la sincronización cloud actual.
  La refactorización no debe introducir escrituras de Firestore durante la
  hidratación fuera de los comandos existentes.
- Mantener aislamiento por tienda y las reglas actuales. No modificar las
  reglas de negocio ni agregar una capa de almacenamiento nueva.

### 3. Retiro seguro de datos heredados del navegador

- Al arrancar, eliminar únicamente `store_os_state_v1` antes de que cualquier
  componente pueda leerlo. No migrar sus tiendas, clientes, pedidos, teléfonos,
  notas u otros datos a Firestore.
- No llamar `localStorage.clear()` ni borrar otras claves.
- Si el navegador impide retirar la clave, nunca cargarla ni utilizarla; mostrar
  un error seguro en el panel y volver a intentar en el siguiente arranque.
- Mantener la preferencia de tienda activa solo como un selector local no
  autoritativo, sujeto a validar que el ID exista en los datos de Firestore del
  usuario actual.

### 4. Usos de almacenamiento que se conservan

- Carrito público del catálogo por tienda.
- Preferencias de tema y preferencias de interfaz; el perfil de Firestore sigue
  siendo la fuente de verdad de preferencias sincronizadas.
- Borradores de captura de pedido ligados al UID, tienda y pedido. Un borrador
  recupera texto de captura, no confirma una venta ni actualiza inventario.
- Cachés y almacenamiento interno del Service Worker/PWA. La actualización de
  código conserva su política vigente y no depende del estado administrativo.
- `scripts/seed-dev.cjs`, fixtures E2E y Firebase Emulators. Todo seed conectado
  usa explícitamente `store-os-dev`; las suites contra emulador se enrutan a
  `127.0.0.1`.

## Autenticación y rutas

- Sin sesión, todas las rutas administrativas presentan `AuthScreen`.
- Auth se suscribe con Firebase válido; errores de red o de Auth se muestran
  como errores de acceso, nunca como señal para activar persistencia local.
- Cada comando que escribe tiendas, productos, categorías, proveedores,
  compras, clientes o pedidos exige sesión y autorización de tienda.
- Las rutas públicas siguen accesibles sin sesión y consultan las proyecciones
  públicas mediante Firebase. Si la configuración obligatoria no existe, el
  arranque muestra el error de configuración indicado arriba.

## Pruebas y E2E

- Sustituir los tests que dependen de Firebase ausente por mocks explícitos de
  Auth y de la capa Firebase. Ningún test de runtime debe seleccionar la
  persistencia administrativa local para aislarse.
- Verificar el contrato del provider: sesión ausente no habilita comandos; sesión
  válida hidrata Firestore; error de Auth/Firestore no escribe localmente y no
  comunica éxito.
- E2E sin sesión: entrar a `/` y a rutas administrativas y comprobar que se ve
  `AuthScreen`, aunque existan datos falsos en memoria.
- E2E de usuario autenticado: iniciar sesión con Auth Emulator, seleccionar una
  tienda del fixture y realizar operaciones en Firestore Emulator.
- E2E de datos antiguos: preparar `store_os_state_v1` con registros señuelo,
  arrancar la aplicación y verificar que esa clave desapareció, que el señuelo
  no se muestra ni se copia a Firestore y que otras claves permanecen intactas.
- E2E público: leer portada, categoría y producto sin Auth desde la proyección
  Firebase; verificar que no aparecen costos ni campos privados.
- Las pruebas Firebase usan el ID lógico `store-os-dev` y servicios locales.
  Ninguna prueba usa datos remotos ni `store-os-f7cf8`.

## Criterios de aceptación

1. `npm run typecheck`, `npm run test` y `npm run build` pasan.
2. `npm run e2e` y los workflows de CI relevantes pasan.
3. Sin sesión, el panel presenta `AuthScreen`; una sesión válida permite operar
   normalmente contra Firebase.
4. Ninguna operación administrativa usa un fallback local, y los fallos de Auth
   o Firestore nunca aparentan éxito.
5. `store_os_state_v1` se elimina al iniciar; las claves de carrito,
   preferencias y borradores autenticados permanecen.
6. `src/` no contiene rutas operativas basadas en `isFirebaseConfigured`,
   `store_os_state_v1` ni el scaffolding local del panel, salvo código temporal
   estrictamente necesario para retirar la clave antigua.
7. El storefront público, los borradores por UID, emuladores, seeds de dev,
   fixtures y PWA conservan su comportamiento.
8. README, guías de arquitectura, instrucciones de agentes y runtime describen
   el mismo modelo cloud-first.
9. No se introducen migraciones de datos, cambios de negocio, servicios externos
   ni escrituras a proyectos Firebase remotos durante pruebas.

## Dependencias y bloqueo actual

La Fase B no inicia hasta integrar en `main` los PR #89–#94 y #103–#107, #109
y #110, y cerrar el PR #108. Al 30 de octubre de 2026 siguen abiertos como
draft; los commits locales de una rama de integración no sustituyen su
integración al `main` protegido.

El PR #108 agrega un camino de acceso administrativo local y contradice esta
decisión. Debe permanecer bloqueado y fuera de la integración. Su cierre queda
a cargo de su autor o de la persona responsable del repositorio; esta tarea no
lo cierra ni modifica PRs ajenos.

Al desbloquearse, implementar en una rama independiente
`chore/eradicate-local-mode` desde el `main` actualizado y abrir el PR dedicado.
Los cambios que afecten simultáneamente runtime y tests deben ir en commits
atómicos que mantengan compilación y suites válidas en cada entrega revisable.

## Fuera de alcance

- Borrar `scripts/seed-dev.cjs`, emuladores, fixtures o el carrito público.
- Eliminar `localStorage` completo o cambiar el almacenamiento del tema,
  preferencias y borradores autenticados.
- Migrar los datos administrativos antiguos del navegador a Firestore.
- Cambiar lógica de negocio, permisos, reglas multitienda, modelo financiero o
  Service Worker.
- Abrir este PR de implementación durante Fase A, cerrar PR #108 o integrar
  cambios a `main`.
