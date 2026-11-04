# Respaldos de producción: Mac → iCloud

Herramienta interna para Firestore, Firebase Auth y Storage. No cambia la app ni
instala tareas al hacer merge. Refs #182. Su aceptación operativa requiere una
copia real restaurada por el propio script y una ejecución programada. La descarga remota de iCloud queda fuera del alcance por indicación del usuario.

## Papelera y alcance de aceptación

Toda retirada de archivos utiliza `trash` de macOS (`trash-put` en CI Linux),
no borrado permanente. Esto incluye retención, copias pendientes y temporales.
La Papelera puede conservar documentos, cuentas y claves temporales de verificación;
no se vacía automáticamente. La custodia y el vaciado quedan bajo control humano.
La retención limita archivos en la carpeta activa, no el espacio total de la Papelera.
Mantener FileVault y acceso protegido también para este material.

La aceptación solicitada se limita al archivo local en el path configurado y su
restauración comprobada. La descarga remota desde iCloud queda fuera del alcance;
`cloudAvailability` permanece `not-verified`.

## Decisiones y límites

- Destino autorizado: `/Users/imalvaroglez/Library/Mobile Documents/com~apple~CloudDocs/Olivia/cio/backups`.
  Las barras invertidas del comando de terminal no forman parte de este nombre.
- Todos los días a las 21:00 `America/Mexico_City`; 30 últimas copias diarias
  y la última copia disponible de cada una de las 12 últimas semanas (lunes–domingo).
  Una misma copia puede satisfacer ambas retenciones. No se fabrican días omitidos.
- `launchd` comprueba al iniciar sesión y cada 15 minutos. El calendario local
  dispara también a las 21:00; el cálculo interno siempre usa Ciudad de México.
  Si cambia la zona del sistema, el intervalo ejecuta la tarea dentro de los
  siguientes 15 minutos. Dormida: se recupera al despertar; apagada o sin sesión:
  al volver a iniciar sesión. No despierta ni enciende la computadora.
- Preferencia de cero costos según decisión de Álvaro del 3 de noviembre de 2026.
  No se habilitan backups administrados, PITR ni nuevos servicios con cobro.
  Las lecturas/descargas normales consumen cuota; no se promete costo cero sin medir.
- Firestore se recorre por páginas incluyendo descendientes de documentos ausentes.
  Se conservan valores REST tipados: int64, dobles, bytes, timestamps, referencias,
  arreglos, mapas y geopuntos. No se reconstruyen padres ausentes. Metadatos de
  creación/actualización Firestore son administrados por Google y no se restauran.
- Capturas entre servicios y páginas no son atómicas. El manifiesto registra
  intervalos. Durante actividad concurrente puede haber referencias a datos
  modificados en otro intervalo; programar en horario de poca actividad.
- Storage captura objetos activos sin descompresión automática (incluidos gzip),
  verifica tamaño y fija generación al descargar y guarda sus
  metadatos completos. La restauración recupera contenido, nombre, tipo,
  cacheControl, disposition, encoding, language y metadatos personalizados.
  `customTime` también se restaura cuando está presente. Generaciones, fechas y otros campos administrados por Google se regeneran;
  no se respaldan versiones borradas, IAM, retenciones legales ni ACL de bucket.
- Auth conserva cuentas, UID, proveedores, claims y hashes, junto con parámetros
  SCRYPT. No incluye sesiones activas, credenciales OAuth de proveedores ni
  configuración de infraestructura externa. Configurar proveedores/dominios de
  Auth e IAM sigue siendo una tarea humana en una recuperación real.
- iCloud sincroniza también borrados. El estado local **no demuestra** que exista
  copia remota. Esta instalación no certifica sincronización con APIs privadas de Apple.
- Sólo se restaura en emuladores locales vacíos. No existe comando para restaurar
  producción. No usar datos reales para pruebas en dev remoto ni publicarlos en Git.

## Preparación humana después de integrar el PR

1. Actualizar `main` y verificar el commit aprobado. Instalar Node 22+, Firebase CLI,
   Java 21 y `age` desde sus distribuidores oficiales (`brew install age`). Comprobar
   que iCloud Drive funciona y que queda espacio local suficiente para datos,
   archivo comprimido y copia cifrada. El temporal vive fuera de iCloud con modo 0700.
   Activar FileVault: borrar temporales no garantiza borrado físico en APFS/SSD.
2. En Firebase/Google Cloud, verificar el nombre real del bucket de producción y
   backups/PITR existentes. `preflight` también consulta base y calendarios; no
   modifica su configuración. El ejemplo usa el sufijo `firebasestorage.app`;
   también se admite `store-os-f7cf8.appspot.com` si ése es el bucket real.
3. Una persona crea la cuenta `store-os-backup-reader` en `store-os-f7cf8`.
   Crear un rol personalizado usando `scripts/backups/reader-role.json` y asignarlo
   **sólo a esa cuenta en ese proyecto**. Para Storage asignar `roles/storage.objectViewer`
   únicamente al bucket indicado. El rol permite leer configuración de backups,
   documentos, cuentas y material de contraseña; no crear/modificar/borrar datos,
   administrar IAM ni ejecutar exportaciones. No reutilizar la cuenta de CI.
   Revisar estas concesiones antes de aplicarlas; el agente no las aplica.
4. Crear el directorio local e introducir allí la credencial dedicada por un canal
   seguro; no pegar el JSON en chat, issues ni historial de comandos:

   ```sh
   mkdir -p "$HOME/Library/Application Support/Store OS Backups"
   chmod 700 "$HOME/Library/Application Support/Store OS Backups"
   chmod 600 "$HOME/Library/Application Support/Store OS Backups/credentials.json"
   ```

   La cuenta de servicio debe pertenecer a producción. La credencial no puede
   vivir en iCloud, en el repositorio ni en un enlace hacia esos destinos.
   El equipo debe permanecer protegido y la cuenta sólo tener lectura.
5. Una persona genera un par de claves `age` en un temporal privado local y guarda
   **la identidad privada en su gestor de contraseñas**. Comprobar que puede
   recuperarla desde otro dispositivo. No compartirla en chat ni guardarla junto
   a los respaldos. Conservar sólo el destinatario público en la configuración;
   enviar a la Papelera el temporal privado después de la prueba de recuperación. La tarea
   automática nunca recibe la identidad privada de recuperación. Genera una
   identidad adicional temporal por ejecución para comprobar el archivo y la
   envía a la Papelera al terminar; la clave permanente sigue bajo tu custodia.
6. Copiar `scripts/backups/config.example.json` al directorio local como `config.json`
   (0600). Sustituir bucket, destinatario y rutas absolutas de `age` y `firebase`. Revisar
   `productionReadApproved` y ponerlo en `true` **únicamente** tras autorizar la
   lectura real con la identidad dedicada. Dejar límites y hash de revisión sin
   aprobar hasta completar el preflight. No guardar esta configuración en Git.
7. Desde el commit integrado, ejecutar:

   ```sh
   node scripts/backups/install.mjs --install-after-merge
   ```

   Instala código y dependencias fijadas por `package-lock.json` en
   `~/Library/Application Support/Store OS Backups/runtime`, más el plist en
   `~/Library/LaunchAgents/mx.store-os.backups.plist`. No activa `launchd`, no
   instala credenciales, no genera claves, no conecta a producción y no depende
   de la supervivencia del worktree. Conserva dependencias de desarrollo porque
   `firebase-admin` ya vive en ese grupo del lock; ignora scripts de instalación.
8. Recuperar una vez la identidad privada desde el gestor a un temporal privado
   fuera de Git/iCloud y comprobar que corresponde al destinatario configurado:

   ```sh
   node "$HOME/Library/Application Support/Store OS Backups/runtime/scripts/backups/cli.mjs" check-key --identity /ruta/privada/identity.txt
   ```

   Guarda únicamente `recovery-key-proof.json` (destinatario público, proyecto y
   fecha), nunca la identidad ni su ubicación. Eliminar el temporal privado
   después. Cambiar el destinatario exige repetir esta comprobación. `run`
   se niega a leer producción sin esta prueba inicial; no acepta `--identity`.

## Custodia en el Llavero de macOS

La configuración local también puede guardar la identidad de recuperación en
el Llavero de macOS como contraseña genérica con servicio
`Store OS backup recovery age` y cuenta `store-os-f7cf8`. Esto es distinto de
confirmar una entrada en la app Contraseñas o sincronización entre dispositivos.
El agente programado no consulta este elemento ni recibe la clave permanente.
Para una recuperación manual, crear primero un directorio privado fuera de
Git/iCloud y recuperar allí la clave, sin imprimirla:

```sh
umask 077
security find-generic-password -s 'Store OS backup recovery age' -a store-os-f7cf8 -w > /ruta/privada/identity.txt
```

Comprobar `check-key` y usar `verify`/`restore` con ese archivo. Al terminar,
enviar el archivo y su directorio temporal a la Papelera con `trash`.
Si se pierde esta Mac sin otra copia de la clave, los archivos cifrados podrían
quedar inaccesibles. La persona custodio debe conservar una vía independiente
de recuperación de la clave; la disponibilidad entre dispositivos no se certifica.

## Preflight y primer respaldo

Los siguientes comandos se ejecutan por una persona después del merge y la
configuración anterior. No usar variables de emuladores en la sesión productiva.

```sh
node "$HOME/Library/Application Support/Store OS Backups/runtime/scripts/backups/cli.mjs" preflight
```

Devuelve sólo conteos, bytes, configuración de backups y hash SHA-256 del reporte.
Lee Firestore completo sin descargar fotos, consulta usuarios y parámetros de
hash, enumera archivos y verifica acceso a las APIs. El reporte vive localmente;
no publica datos de cuentas, documentos ni material de contraseña.

Revisar `preflight.json`: lecturas diarias mínimas ≈ documentos + páginas vacías;
Storage mensual ≈ objetos × 31 descargas y bytes × 31. Añadir tráfico normal,
preflight, posibles reintentos y restauraciones. Las primeras lecturas para
medir volumen ya consumen cuota. Revisar Usage/Billing en consola: el reporte no
conoce el consumo diario acumulado ni garantiza ausencia de cobros.

Establecer `maxDocuments`, `maxStorageBytes`, `maxFirestoreReads` y
`maxDailyFirestoreReads` como techos explícitos autorizados
con margen acorde a esa revisión. El preflight informa las operaciones mínimas
de lectura observadas. El tope por ejecución se aplica durante la paginación;
cada intento reserva todo ese tope contra el presupuesto diario local antes de
leer producción, incluso si falla o se interrumpe. El presupuesto se renueva a
medianoche de Ciudad de México (es independiente del reinicio de cuota de Google).
No reemplaza la supervisión del consumo de la aplicación. Copiar `approvalSha256` a
`reviewedPreflightSha256`. Cambiar proyecto, bucket, destino o destinatario
invalida la aprobación y exige repetir preflight. No activar nuevos servicios.

```sh
node "$HOME/Library/Application Support/Store OS Backups/runtime/scripts/backups/cli.mjs" run
node "$HOME/Library/Application Support/Store OS Backups/runtime/scripts/backups/cli.mjs" status
```

Cada `run` exige completar este ciclo antes de anunciar éxito:

1. Capturar Firestore, Auth y archivos con manifiesto y hashes.
2. Generar una identidad de verificación descartable y cifrar **un solo archivo**
   para el destinatario permanente y el temporal.
3. Copiarlo a iCloud como `.partial`; releer y descifrar esa copia exacta, validar
   archivos/hashes y compararla con el manifiesto original de la captura.
4. Restaurar Firestore, Auth y Storage en emuladores propios, vacíos y temporales,
   con proyecto `store-os-dev`. Comparar documentos/tipos, cuentas/perfiles/fechas,
   proveedores/claims, hashes y sales de contraseña productivos, y contenido y
   metadatos de cada archivo. La verificación no vuelve a consultar producción.
5. Cerrar esos emuladores y enviar a la Papelera temporal, datos descifrados y clave temporal.
   Publicar el nombre final `backup-<fecha UTC>.tar.gz.age`, guardar el comprobante
   ligado al SHA-256 de ese archivo y sólo entonces registrar éxito y podar.

Si descifrar, comparar o restaurar falla —incluidos puertos ocupados, falta de
Java/Firebase o un verificador que termina sin comprobante— no se publica un
nuevo respaldo válido, no avanza `lastSuccess`/el ciclo satisfecho y no se ejecuta
retención. Se conservan la copia anterior y su comprobante. Nunca se sustituye la
restauración por un simple hash ni hay opción para omitirla.

El comprobante local incluye fecha, hash del cifrado y del manifiesto de origen,
conteos, verificación de la clave pública de recuperación y resultados de
restauración. No contiene datos personales ni claves privadas. Los éxitos de
versiones anteriores sin comprobante no cuentan como respaldos verificados.

Los puertos propios son Firestore 18080, Auth 19099, Storage 19199, hub 14400,
logging 14500 y websocket 19150, siempre en 127.0.0.1. El directorio temporal y
el archivo de coordinación del hub están aislados de los emuladores de desarrollo
8080/9099/9199. Si están ocupados, falla; no reutiliza ni borra servidores ajenos.
La restauración tiene un límite de tres minutos. Un supervisor separado sigue
activo si muere el proceso principal: cierra los procesos propios (incluidos
hijos separados), fuerza su terminación si no responden y envía datos y claves a la Papelera
antes de permitir publicación. El traslado de todo el espacio privado a la Papelera es
una condición de éxito. Los temporales abandonados por una caída del sistema se
envían a la Papelera al siguiente arranque antes de preflight, presupuesto y runtime; FileVault
sigue siendo necesario mientras el equipo está apagado. El borrado físico de temporales
no está garantizado en SSD/APFS: mantener FileVault y acceso al equipo protegido.

Sólo el cifrado pasa por iCloud; el archivo `.partial` nunca cuenta como éxito.
La retención sólo envía a la Papelera nombres registrados por esta instalación, después de
crear una copia nueva restaurada correctamente. Archivos ajenos nunca se podan.
No borrar `state.json`: contiene el inventario y el comprobante de la última copia.

La limpieza de arranque omite consultas de procesos si no hay temporales `capture-*`.
Las consultas de procesos tienen un plazo máximo de cinco segundos para tolerar
la ejecución en segundo plano; si se agota, se informa `PROCESS_INSPECTION_TIMEOUT`
y se conservan los temporales cuya propiedad no pudo determinarse. El supervisor
dispone de hasta quince segundos para iniciar.

La exclusión mutua reserva el puerto local 43827 mientras corre la tarea. Al
terminar, morir el proceso o reiniciar la Mac, el sistema libera el puerto. El
archivo `run.lock` es sólo diagnóstico: se reemplaza al obtener exclusividad.
Si otro programa ocupa ese puerto, la tarea no corre y el estado avisa cuando
el respaldo supera 26 horas.

Si aumenta el volumen por encima de los límites, falla explícitamente y suspende
reintentos hasta que una persona genere y apruebe un nuevo preflight. Al agotarse
el presupuesto diario se omiten intentos hasta el siguiente día. Volver a
preflight, revisar consumo y aprobar límites. No aumentar automáticamente.

## Recuperación comprobable

1. Descargar un archivo `.age` desde iCloud web o un segundo dispositivo; no usar
   la misma ruta sincronizada como prueba. Comparar SHA-256 con el estado local.
   Conservar evidencia sanitizada de fecha, archivo, tamaño y hash. `status`
   seguirá indicando `cloudAvailability: not-verified`; la verificación externa
   es un registro humano, no una suposición automática.
2. Recuperar la identidad privada del gestor en un temporal protegido **fuera de
   iCloud y Git**. Crear configuración de prueba local separada con proyecto
   `store-os-dev`, bucket `store-os-dev.firebasestorage.app`, `home` temporal,
   `destination` temporal y ruta de `age`; no necesita credenciales productivas.
3. Desde el directorio `~/Library/Application Support/Store OS Backups/runtime`
   (incluye configuración y reglas para recuperación), iniciar emuladores vacíos; validar sólo localhost. Nunca usar un emulador
   compartido con otra tarea. Usar estos valores exactos en la sesión:

   ```sh
   export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
   export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
   export FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
   firebase emulators:start --project store-os-dev --config firebase.emulator.json --only auth,firestore,storage
   ```

4. En otra terminal con las mismas variables, desde el runtime instalado:

   ```sh
   node scripts/backups/cli.mjs verify --config /ruta/privada/emulator-config.json --archive /ruta/privada/copia.age --identity /ruta/privada/identity.txt
   node scripts/backups/cli.mjs restore --config /ruta/privada/emulator-config.json --archive /ruta/privada/copia.age --identity /ruta/privada/identity.txt
   ```

   `verify` ahora también restaura en emuladores temporales propios y devuelve
   su comprobante; no altera los emuladores de desarrollo. `restore` es la
   restauración manual al destino local vacío indicado. Ambos verifican conjunto
   de archivos y hashes antes de escribir. Rechaza destinos
   remotos, proyecto productivo, emuladores incompletos o no vacíos. Remapea sólo
   referencias Firestore a `store-os-dev`, preservando UID y membresías. Comprueba
   documentos y tipos, cuentas/proveedores/claims y bytes/metadatos de fotos.
   Un fallo puede dejar restauración parcial **en emuladores**; descartarlos y
   reiniciar vacíos. No implica rollback ni escrituras en producción.
5. Comprobar relaciones de la tienda, pedidos, clientas y acceso con la app contra
   emuladores; no cambiar membresías para aparentar éxito. El emulador de Auth
   **no certifica** hashes SCRYPT reales: se conserva el material completo, pero
   `authPasswordLoginVerified` será `false`. La prueba sintética sí comprueba su
   propio inicio de sesión. Una recuperación real de cuentas exige un ensayo
   humano específico autorizado; no se declara verificada por el emulador.
6. Detener emuladores y enviar sus temporales y la identidad privada de prueba a la Papelera.
   Mantener sólo reporte sin PII y archivos cifrados. Repetir mensualmente y antes
   de cambios de esquema importantes.

## Activación, observación y mantenimiento

Tras verificar el primer respaldo local:

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/mx.store-os.backups.plist"
launchctl print "gui/$(id -u)/mx.store-os.backups"
```

Guardar evidencia de la **primera ejecución programada** correcta, con fecha,
conteos y comprobación de su archivo. Hasta entonces, #182 no tiene aceptación
operativa. Autorizar notificaciones de la terminal si macOS las bloquea.

`status` muestra antigüedad, tamaño, bloqueo, comprobante y error sanitizado.
Comprueba además que el archivo actual conserva el SHA-256 que se restauró; si
no coincide, `hasVerifiedBackup` es falso. Las comprobaciones periódicas de
`launchd` usan el comprobante y la existencia del archivo, sin descargar ni
recalcular archivos grandes cada 15 minutos. La verificación completa de cada
nuevo archivo sigue siendo obligatoria. Fallas o antigüedad >26 horas generan aviso local, limitado a uno por
tipo al día. Si la Mac está apagada, la herramienta tampoco puede alertar: revisar
estado al volver. Logs del agente contienen sólo estados sanitizados; rotarlos
periódicamente cuando crezcan. La tarea omite silenciosamente ejecuciones sin
respaldo pendiente.

Tras una interrupción, el puerto se libera automáticamente y la siguiente ejecución recupera el trabajo.
Si existe un marcador `run.lock` antiguo, revisar el PID registrado. `unlock`
sólo lo retira si ese proceso ya no existe. Nunca quitarlo mientras haya una tarea
activa. La siguiente ejecución limpia temporales `capture-*` de esa instalación.
Borrado seguro físico no garantizado. Una copia incompleta `.partial` que quede
tras apagado se puede retirar manualmente después de comprobar que no hay tarea
activa; no se cuenta como copia válida.

Para actualizar: desactivar con `launchctl bootout`, comprobar que terminó el
proceso y que no hay bloqueo; conservar config, credencial, estado y copias;
retirar el runtime antiguo y el plist, instalar desde el nuevo commit integrado,
repetir pruebas y activar. No actualizar código mientras se ejecuta un respaldo.
Para desinstalar: bootout y retirar sólo plist/runtime. Las copias y claves no
se eliminan automáticamente. Rotar credenciales y recuperar la clave del gestor
son tareas humanas.

## Pruebas del desarrollo

```sh
npm run test:backup
npm run test:backup:emulator
npm run typecheck
npm run test
npm run build
```

Además del ensayo de 504 documentos y objetos gzip, la aceptación ejecuta los
comandos reales `preflight`, `run`, `verify` y `restore` con dos tiendas y 1,004
cuentas sintéticas (paginación de Auth, contraseña, proveedor Google y cuenta
deshabilitada). Compara datos y archivos con la fuente, comprueba saldo/existencias,
inicio de sesión y aislamiento entre tiendas. Cada `run` abre y restaura
automáticamente la copia cifrada en emuladores aislados; se prueba que el fallo
del verificador conserva el respaldo previo y que un proceso sin comprobante
no puede anunciar éxito. La clave permanente se retira de su ubicación durante
la ejecución para demostrar que la tarea no depende de ella. Se mata además
un `run` durante descifrado real y se comprueba que el supervisor envía a la Papelera claves,
datos privados y la copia pendiente, conservando el respaldo anterior. Los
procesos colgados y descendientes separados que ignoran SIGTERM se prueban con
terminación forzada. La verificación rechaza pérdidas de factores MFA y comprueba
hashes y sales con material SCRYPT sintético de formato productivo. Rechaza clave equivocada, cifrado
truncado, datos alterados con cifrado válido y destino ocupado, verificando que
los rechazos no creen datos ni cambien la recuperación anterior.

El ensayo completo usa sólo datos sintéticos en los emuladores de `store-os-dev`;
no accede a producción ni a iCloud. CI instala `age` y ejecuta el mismo ciclo.

Referencias: [tipos y documentos REST](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents),
[exportar usuarios y hashes](https://firebase.google.com/docs/auth/admin/manage-users),
[configuración de hash](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/Config),
[cuotas](https://firebase.google.com/docs/firestore/quotas),
[programación macOS](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html).
