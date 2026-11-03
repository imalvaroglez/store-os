# Respaldos de producción: Mac → iCloud

Herramienta interna para Firestore, Firebase Auth y Storage. No cambia la app ni
instala tareas al hacer merge. Refs #182. Su aceptación operativa requiere una
copia real restaurada, descarga independiente desde iCloud y una ejecución programada.

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
   eliminar el temporal privado después de la prueba de recuperación. La tarea
   automática nunca recibe la identidad privada.
6. Copiar `scripts/backups/config.example.json` al directorio local como `config.json`
   (0600). Sustituir bucket, destinatario y ruta absoluta de `age`. Revisar
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

Una ejecución correcta crea `backup-<fecha UTC>.tar.gz.age`. Sólo cifrado completo
se publica: primero `.partial`, validación de hash y rename; ningún temporal
legible pasa por iCloud. Un fallo conserva las copias anteriores. La retención
sólo elimina nombres registrados por esta instalación, después de publicar y
registrar una copia nueva. Archivos ajenos nunca se podan. No borrar `state.json`:
contiene el inventario de propiedad y la fecha de última ejecución correcta.

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

   Verifica conjunto de archivos y hashes antes de escribir. Rechaza destinos
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
6. Detener emuladores, eliminar sus temporales y la identidad privada de prueba.
   Mantener sólo reporte sin PII y archivos cifrados. Repetir mensualmente y antes
   de cambios de esquema importantes.

## Activación, observación y mantenimiento

Tras verificar el primer respaldo y su descarga remota:

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/mx.store-os.backups.plist"
launchctl print "gui/$(id -u)/mx.store-os.backups"
```

Guardar evidencia de la **primera ejecución programada** correcta, con fecha,
conteos y comprobación de su archivo. Hasta entonces, #182 no tiene aceptación
operativa. Autorizar notificaciones de la terminal si macOS las bloquea.

`status` muestra antigüedad, tamaño, bloqueo, disponibilidad local y error
sanitizado. Fallas o antigüedad >26 horas generan aviso local, limitado a uno por
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

El ensayo completo usa sólo datos sintéticos en los emuladores de `store-os-dev`;
no accede a producción ni a iCloud. CI instala `age` y ejecuta el mismo ciclo.

Referencias: [tipos y documentos REST](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents),
[exportar usuarios y hashes](https://firebase.google.com/docs/auth/admin/manage-users),
[configuración de hash](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/Config),
[cuotas](https://firebase.google.com/docs/firestore/quotas),
[programación macOS](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html).
