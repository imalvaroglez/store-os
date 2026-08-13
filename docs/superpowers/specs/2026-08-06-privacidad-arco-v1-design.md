# Privacidad y ARCO V1 — Diseño (Espec 2)

Delivery-ID: privacy-arco-v1
Delivery-Status: Pending approval

**Fecha:** 2026-08-06
**Autor:** Álvaro González (Product Owner) + Claude (Tech Lead)
**Estado:** Diseño (pendiente de aprobación; apartados legales sujetos a validación jurídica)

> Complemento de la Espec 1 (Security harness). Los invariantes verificables técnicamente (miembro no lee ARCO, anónimo no escribe privado, ARCO sólo dueña, cliente sin telemetría opcional) viven allí (G-P04, G-P05, G-P08 y §3 egress). Aquí vive el procedimiento humano de tratamiento. Una sola voz editorial.

**Convención de nombres.** *Olivia* = la tienda o nombre comercial. *Fer* = la persona que la opera y toma las decisiones de tratamiento. La **identidad de la responsable jurídica** (Olivia como persona moral, o Fer como persona física bajo el nombre comercial Olivia) **se confirma antes de publicar el aviso** (§3.2); la LFPDPPP aplica a personas físicas o morales privadas que realizan el tratamiento, y el nombre comercial por sí mismo no resuelve quién es responsable.

---

## 1. Propósito y nivel de afirmación

### Propósito

Establecer cómo Store OS trata los datos personales de las clientas que Olivia gestiona (nombre, teléfono, notas, historial de pedidos), conforme a la **LFPDPPP**; entregar en V1 un **procedimiento ARCO funcional asistido por la responsable**; y declarar la relación **responsable / encargado**.

### Nivel de afirmación

Esta spec define el tratamiento y el procedimiento. La **validez legal final** del aviso, del ATD y del mecanismo de acreditación de identidad requiere **revisión jurídica humana** (marcado "sujeto a validación legal" donde aplique). **No se declara cumplimiento GDPR** formal; sólo principios inspirados.

### Vínculo con la Espec 1

El procedimiento humano (plazos, retención, redacción del aviso, canal) vive aquí. Las garantías técnicas que lo sostienen (miembro no lee ARCO, anónimo no escribe privado, ARCO sólo dueña) viven en la Espec 1 (G-P04, G-P05, G-P02).

---

## 2. Marco normativo

- **Cumplimiento de la LFPDPPP** (Ley Federal de Protección de Datos Personales en Posesión de los Particulares) y su **Reglamento**.
  - Ley: https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf
  - Reglamento: https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LFPDPPP.pdf
- **Principios inspirados en el GDPR** (minimización, derecho al olvido, registro de tratamiento) **sin declarar cumplimiento GDPR** formal.

### Términos clave (lenguaje simple)

- **Titular:** la persona a quien corresponden los datos (la clienta).
- **Responsable:** quien decide las finalidades y los medios del tratamiento.
- **Encargado:** quien trata los datos por cuenta del responsable.
- **ARCO:** derechos de acceso, rectificación, cancelación y oposición.
- **Aviso de privacidad:** documento que informa al titular el tratamiento.

> **Los datos corresponden a la titular.** La responsable (Olivia) decide finalidades y medios; no "posee" los datos. Corregido el error de versiones previas ("los datos pertenecen a la dueña").

---

## 3. Modelo normativo de roles

### 3.1 Responsable y encargado por contexto de datos

| Datos | Responsable | Encargado |
|---|---|---|
| Clientas, teléfonos, notas y pedidos de Olivia | Olivia (operada por Fer) | Store OS |
| Datos de acceso de usuarios de la plataforma (Fer, miembros, admin) | Store OS | Firebase y demás proveedores |
| Datos de clientas almacenados en Firebase | Olivia | Store OS → Google/Firebase (subencargado) |

**Cadena:** *titular → Olivia (responsable) → Store OS (encargado) → Firebase (subencargado).*

> La capacidad técnica de leer no determina el rol legal; las **finalidades** sí. Store OS es encargado porque procesa por cuenta de Olivia.

### 3.2 Responsable jurídico real (sujeto a confirmación)

La responsable debe ser el **sujeto jurídico real**, no un nombre comercial:
- Si "Olivia" es **persona moral** constituida, la responsable es esa persona moral.
- Si "Olivia" es sólo **nombre comercial**, la responsable es **Fer, operando bajo el nombre comercial Olivia**.

**Acción (pendiente, no bloquea V1 de producto):** confirmar con Fer la figura jurídica de Olivia antes de publicar el aviso. El aviso debe identificar al sujeto real y su domicilio (arts. 15-16 LFPDPPP).

### 3.3 super_admin: plano de CONTROL, no facultad contratada

**Decisión normativa única (corrige la contradicción de versiones previas):** `super_admin` **no obtiene acceso al plano de datos por su rol**. La vista-dios actual de `super_admin` (ver Espec 1 §9, GAP-G-P02) es **exclusivamente un GAP de migración**, **no** un riesgo aceptado ni una facultad contratada.

- En el ATD (§6) **no se legitima** la vista-dios. Store OS se obliga a procesar los datos de clientas **sólo bajo instrucción de Olivia** y a **no conservar ni usar** esa PII para finalidades propias.
- Si Store OS requiere dar soporte que toque datos privados, lo hace **entrando como miembro autorizado de ESA tienda**, concedido y revocable por la dueña — no por el rol `super_admin`.
- El acceso privilegiado de infraestructura (consola/IAM/Admin SDK) es break-glass para emergencias con procedimiento (Espec 1 §3).

---

## 4. Separación de planos (control vs datos)

- **Plano de CONTROL (super_admin):** administra la plataforma (usuarios, tiendas, propietarios, configuración, metadatos operativos mínimos). **No concede acceso ordinario a los datos privados de las tiendas** (PII de clientas, pedidos, proveedores, compras, notas privadas, ARCO).
- **Plano de DATOS (miembros autorizados de la tienda):** acceso por tienda concreta vía `memberUids`.
- **Acceso de soporte:** miembro autorizado de la tienda, visible, revocable, atribuible a la dueña.
- **Compromiso de finalidades:** Store OS **no** utilizará datos de las tiendas para finalidades propias (analítica comercial, publicidad, entrenamiento de modelos). Procesa únicamente bajo instrucción de la tienda responsable.

> **Promesa correcta:** *Store OS no tiene acceso ordinario mediante el producto. El acceso privilegiado de infraestructura se reserva para incidentes, recuperación o requerimientos legales, con motivo documentado y notificación a la responsable.*

**GAP actual (referenciado desde Espec 1):** HOY `isSuperAdmin()` short-circuit (`firestore.rules:14,19`) viola esta separación. La separación es **norma**; alcanzarla es trabajo de implementación (Espec 1 GAP-G-P02). El procedimiento ARCO no depende de ese cambio, pero los permisos de `privacyRequests` sí respetan `ownerUid` desde el diseño.

---

## 5. Mapa de tratamiento de datos

Mapa (no lista de campos). Columnas: Categoría | Titular | Finalidad | Base legal | Ubicación | Quién accede | Terceros/subencargados | Retención/bloqueo/eliminación.

### 5.1 Filas

| Categoría | Titular | Finalidad | Base legal | Ubicación | Acceso | Terceros | Retención |
|---|---|---|---|---|---|---|---|
| Clientas: nombre, teléfono, notas (texto libre), historial de pedidos | La clienta | Gestión de ventas y pedidos | Consentimiento de la clienta para gestionar la venta; obligaciones derivadas de la relación jurídica y legales/fiscales | Firestore `customers`, `orders` (acotados por `storeId`); **nunca** en proyecciones públicas | Dueña y miembros de Olivia por membresía. **Hoy también `super_admin` (GAP, Espec 1)** | Google/Firebase (subencargado) | Relación comercial + obligaciones legales/fiscales; ARCO cancelación → bloqueo luego supresión |
| Cuentas de usuario: email, displayName, rol, createdAt | La persona usuaria | Autenticación y autorización | Consentimiento (crear cuenta) y relación contractual con Store OS | Firebase Auth + Firestore `users` | **Riesgo residual declarado (fuera de V1):** HOY `users/{uid}` permite `read` a **cualquiera autenticado** (`firestore.rules:40-41`) — cualquier usuario lee email/displayName/rol de cualquier otro. Esto **no** está cubierto por una garantía del producto en V1 (Espec 1 §11); protegerlo requeriría una futura G-P09 (directorio mínimo). Se declara abiertamente, no se oculta como mero "GAP" | Google/Firebase | Mientras dure la cuenta; supresión al cerrar |
| Invitaciones pendientes (`pendingInvites`: emails) | La persona invitada | Gestión de membresía | Consentimiento / relación comercial para integrar al equipo | Firestore `stores.pendingInvites` | **GAP:** cualquier miembro puede leer el doc `stores` completo incluidos los emails (`firestore.rules:54-55`). No afirmar "sólo dueña/super_admin ven los emails" | — | Hasta conversión en miembro o revocación |
| Proveedores (suppliers: contacto, notas) | El proveedor | Gestión de abastecimiento | Consentimiento / relación comercial | Firestore `suppliers` (membership-gated) | Dueña y miembros de Olivia | Google/Firebase | Relación comercial; supresión al terminar |
| Texto libre / notas (customer.notes, supplier.notes, order.notes, product.privateNotes) | Varía | Contenedor de información operativa | La del contenedor | Firestore | La del contenedor | — | La del contenedor; **riesgo de PII no estructurada** — revisar en cada acceso ARCO |
| Fotos de productos | Olivia (la tienda) | Catálogo público | Propio (datos de la tienda) | Storage `/products` (lectura pública) + `publicProducts` | Dueña/miembros escriben; anónimos leen | — | Mientras el producto esté publicado. **No afirmar "no PII":** las imágenes están destinadas a productos, pero una persona miembro puede subir accidentalmente una cara, dirección o etiqueta. Riesgo de contenido incidental aportado por la tienda |
| Solicitudes ARCO (`privacyRequests`) | La titular solicitante | Tramitar derechos ARCO | Cumplimiento de obligaciones legales de la responsable | Firestore `privacyRequests` | **Sólo la dueña** (`ownerUid`) | — | Ver §10 retención |
| localStorage (modo demo) | — | Demo local | — | Navegador | El usuario del navegador | — | NUNCA debe contener PII real de clientas en cloud; modo demo sólo datos ficticios sembrados |
| WhatsApp (`wa.me`) | La clienta (canal) | Contacto y respuesta | Iniciado por la persona | Dispositivo/app de WhatsApp de Olivia (fuera del producto) | Olivia | — | **Riesgo de gobernanza:** Olivia NO debe conservar conversaciones como expediente; la retención vive en su WhatsApp, fuera de nuestra jurisdicción |
| Vercel (hosting) | Visitantes y usuarias | Servir la aplicación | Necesario para prestar el servicio | Infraestructura Vercel | Personal autorizado de Vercel | Vercel | Metadatos técnicos (IP, user-agent, ruta, logs para servir); ver §5.3 |

### 5.2 Egress autorizado V1 (corrige "wa.me es el único egress")

Los destinos externos autorizados son: **Firebase** (operación), **Vercel** (servir la aplicación: metadatos técnicos de petición), **WhatsApp** (sólo navegación iniciada por la persona). **El cliente no envía telemetría opcional a servicios de analítica.**

> La afirmación "wa.me es el único egress" y "cero analytics en la ruta pública" eran **FALSAS** en versiones previas: `@vercel/analytics` y `@vercel/speed-insights` se montaban globalmente (`src/main.tsx:3-4`). **V1 los retira por completo** (ver §5.3 y la memoria de decisión).

### 5.3 Vercel: hosting, no receptor de telemetría de producto

- Vercel hospeda la aplicación y procesa **metadatos técnicos de las peticiones** (IP, user-agent, ruta, logs necesarios para servir).
- Store OS **no habilita** los productos opcionales Web Analytics ni Speed Insights en V1.
- Los datos de clientas de Olivia **no van a Vercel**: viajan directo navegador → Firebase.
- **Precaución contractual (sujeta a validación):** el DPA publicado por Vercel aplica a clientes **Pro/Enterprise**. Bajo Hobby + cero costos, **no asumir** cobertura automática del DPA — reflejar los términos realmente aplicables o validarlo jurídicamente (https://vercel.com/legal/dpa).

### 5.4 Casos especiales

- **`sku`:** se proyecta públicamente y se envía a WhatsApp/JSON-LD. Marcado **"público por diseño; revisar si la naturaleza del SKU llegara a ser identificativa."**
- **Firebase como subencargado:** Google/Firebase procesa los datos en nombre de Store OS (que a su vez es encargado de Olivia).

> Este mapa es la fuente que la dueña revisa al tramitar un ARCO (para saber dónde está cada dato) y debe actualizarse cuando se añadan finalidades o ubicaciones.

---

## 6. Avisos de privacidad y Acuerdo de Tratamiento

> **Aclaración terminológica:** en esta spec, **ATD = Acuerdo de Tratamiento de Datos** (entre Olivia y Store OS). No confundir con "análisis" ni "análisis de impacto".

### 6.1 Dos avisos distintos

1. **Aviso de Olivia — para sus clientas.** Visible en el catálogo público (`/privacidad/:slug`), mobile-first, español. Contenido obligatorio (arts. 15-16 LFPDPPP):
   - Identidad y domicilio del **sujeto jurídico real** (Olivia persona moral, o Fer bajo el nombre comercial Olivia — §3.2).
   - Datos tratados (nombre, teléfono, notas, historial de pedidos) y finalidades.
   - Opciones y medios para limitar el uso o divulgación de los datos.
   - Terceros encargados/subencargados (Store OS como encargado; Google/Firebase como subencargado; Vercel como hosting).
   - Derechos ARCO y mecanismo (canal de contacto; sin formulario anónimo que escriba en el producto).
   - Procedimiento y medio para comunicar cambios al aviso.
   - Disponibilidad del aviso en el momento de recolección.
   - El **método de acreditación de identidad** que Olivia usará en ARCO (§7), sujeto a validación jurídica.
   - Editable por la dueña en `StoreSettingsScreen`; **plantilla basada en los requisitos identificados, sujeta a validación jurídica** (no "conforme a LFPDPPP" mientras no esté validada).
2. **Aviso de Store OS — para quienes crean cuenta y usan la plataforma** (Fer, miembros, admin). Declara el tratamiento de datos de cuenta (email, displayName, rol), finalidad (auth/autorización/operación), roles responsable/encargado, y a Vercel como hosting. **Equivalente a §3.2:** debe identificar al **sujeto jurídico real** responsable de Store OS (Álvaro como persona física, o la persona moral que opere la plataforma) y su **domicilio**, con la misma exigencia que el aviso de Olivia — **antes de publicar**. Store OS figura como responsable de los datos de cuenta y como encargado de los datos de clientas de Olivia.

### 6.2 Entrega del aviso en el momento de recolección

No basta con hospedar `/privacidad/:slug`. Cuando Olivia **recoge datos por WhatsApp, teléfono o presencialmente**, debe proporcionar el enlace al aviso o un aviso simplificado en ese momento (arts. 15-16). La spec lo declara como obligación del procedimiento; el producto puede facilitar el enlace, pero la entrega es responsabilidad de la responsable.

### 6.3 Acuerdo de Tratamiento de Datos (ATD)

Entre Olivia (responsable) y Store OS (encargado). **Sujeto a validación jurídica.** Cláusulas mínimas:
- Datos, finalidades y duración.
- Tratamiento únicamente bajo instrucciones de Olivia.
- Confidencialidad y medidas de seguridad.
- Apoyo para ARCO, incidentes y eliminación.
- Qué ocurre al terminar el servicio.
- Subencargados autorizados (Google/Firebase primero; Vercel como hosting).

> **El ATD NO legitima la vista-dios de `super_admin`.** Store OS se obliga a no conservar ni usar la PII de clientas para finalidades propias (§3.3).

### 6.4 Base legal en términos LFPDPPP

La columna "base legal" del mapa usa terminología de la LFPDPPP: **consentimiento** del titular y **excepciones enumeradas** (necesidad de cumplir obligaciones derivadas de una relación jurídica; obligaciones legales/fiscales). **No** usar "interés legítimo" como categoría GDPR sin adaptar; redactar en términos de consentimiento y excepciones de la ley mexicana. Sujeto a validación legal.

---

## 7. Procedimiento ARCO V1 (asistido por la responsable)

**Decisión clave V1:** **sin formulario anónimo que escriba en Firestore.** La página pública (`/privacidad/:slug`) es informativa y de contacto: muestra aviso, requisitos ARCO y canales (WhatsApp y correo de privacidad de Olivia; botón "Iniciar solicitud por WhatsApp" con texto genérico **sin PII en la URL**; opción de atención presencial). La página **no crea documentos, no recibe identificaciones, no acepta archivos**.

### 7.1 Flujo (7 etapas)

**Contacto → Acuse → Validación → Revisión → Determinación → Ejecución → Cierre.**

1. **Inicio público:** la página informa requisitos y ofrece canales. No escribe nada.
2. **Recepción:** la persona envía a Olivia — nombre; medio para notificaciones; derecho(s) solicitado(s); qué datos/tratamiento le preocupa; resultado solicitado; para rectificación, la corrección y su sustento; si actúa mediante representante, indicarlo.
3. **Registro y acuse:** la **dueña** crea manualmente el expediente en Store OS (plano privado de Olivia). El sistema genera un folio (`ARCO-AAAA-NNNN`) y la dueña envía acuse: *"Recibimos tu solicitud ARCO `<folio>` el `<fecha>`. Te responderemos por este medio dentro del plazo aplicable."* Se conservan la fecha original de recepción y la fecha en que quedó completa.
4. **Validación e identidad** (ver §7.3).
5. **Revisión:** la dueña revisa el **mapa completo de tratamiento** (§5), no sólo Firestore (clientes/pedidos, WhatsApp, imágenes, exportaciones/copias locales, otros registros). Store OS ofrece una checklist; **no decide procedencia**.
6. **Determinación:** Olivia comunica dentro de 20 días hábiles — procedente / parcialmente procedente / improcedente con fundamento y explicación / no existen datos de la persona. Una negativa explica el derecho a iniciar el procedimiento de protección correspondiente.
7. **Ejecución:** si procede, Olivia dispone de 15 días hábiles desde la comunicación — Acceso (entrega comprensible por canal verificado); Rectificación (corrige y documenta qué cambió); Cancelación (cesa uso, **bloquea** si hay obligación de conservación, fija fecha de supresión); Oposición (detiene la finalidad y registra la exclusión).

### 7.2 Plazos (LFPDPPP art. 31; Reglamento arts. 95-97) — corrección de citas

> **Corrección importante frente a versiones previas.** Los plazos y sus citas se ajustan a la ley vigente:

- **Recepción:** inicia el cómputo del plazo de determinación.
- **Requerimiento de información faltante:** Olivia puede pedir información faltante **una sola vez dentro de 5 días hábiles** (Reglamento art. 96).
- **Respuesta del titular:** la persona dispone de **10 días hábiles** para contestar el requerimiento (Reglamento art. 96).
- **Interrupción y reanudación:** el requerimiento **interrumpe** el plazo de determinación; si el titular subsana, el Reglamento indica cómo **reanudarlo** (art. 96).
- **Determinación:** Olivia comunica dentro de **20 días hábiles** (LFPDPPP art. 31).
- **Ampliación:** tanto el plazo de 20 como el de 15 días **pueden ampliarse una vez por un periodo igual**, con justificación **notificada** al titular (LFPDPPP art. 31; Reglamento art. 97 regula ampliaciones).
- **Ejecución:** Olivia dispone de **15 días hábiles desde la comunicación de la respuesta favorable** (no desde una determinación interna) (LFPDPPP art. 31).
- **Días = hábiles:** la LFPDPPP define "días" como días hábiles (art. 2). **`not_filed` (§8) se mide en días hábiles, no naturales.**

### 7.3 Acreditación de identidad (un solo procedimiento, condicionado a validación jurídica)

**Procedimiento V1 (unificado — corrige la contradicción de versiones previas):**
- El contacto debe venir del **teléfono asociado a la clienta**.
- La dueña realiza **videollamada o comparecencia presencial con identificación oficial**; nombre e identidad deben coincidir con el registro.
- Store OS conserva **sólo una constancia** (método, fecha, quién verificó). **No** conserva copia de la identificación por defecto.
- Para representantes/menores: trámite manual con documentación correspondiente.

**Condición jurídica explícita:** el Reglamento (art. 89) contempla copia con cotejo del original o mecanismos electrónicos que identifiquen fehacientemente al titular. El mecanismo "sin copia" se presenta **condicionado a validación jurídica** de que es suficiente para acreditar fehacientemente al titular en términos del art. 89 — **no** simultáneamente como suficiente y como pendiente. Si la validación exige conservar copia cotejada, el procedimiento se ajusta (y la copia se retiene según §10). El método debe describirse en el aviso **antes** de producción.

> Corrección: en versiones previas, §7 (etapa 4) decía que una copia quedaba con Olivia fuera del sistema, mientras §9/§11 decían "sin copias" y la retención contemplaba borrar la copia externa. **Esa contradicción se elimina:** un solo procedimiento, arriba.

---

## 8. Estados del expediente ARCO

Los 9 estados de código exactos (**sin** "atendida" — ambigua):

| Estado de código | UI | Significado |
|---|---|---|
| `received` | Recibida | Se recibió y se envió acuse |
| `awaiting_information` | Falta información | Olivia pidió datos o identidad faltante |
| `under_review` | En revisión | Solicitud completa e identidad verificada |
| `approved` | Procedente | Determinación favorable comunicada |
| `denied` | No procedente | Negativa motivada comunicada |
| `executing` | En cumplimiento | Falta ejecutar la acción aprobada |
| `fulfilled` | Cumplida | Acción ejecutada y confirmada |
| `not_filed` | No presentada | No se completó dentro de los 10 días hábiles |
| `closed` | Cerrada | Expediente terminado y retención iniciada |

**Reglas de cierre:** una solicitud sólo está
- **Cumplida:** la acción se ejecutó y notificó;
- **Cerrada por negativa:** se comunicaron motivo y vías de inconformidad;
- **No presentada:** venció el requerimiento de información (10 días hábiles).

Una solicitud **aprobada pero aún no ejecutada sigue abierta**.

### 8.1 Procedencia total y parcial (`determinationKind`)

El art. 33 LFPDPPP admite **negativas parciales**: una solicitud puede ser procedente en parte y denegada en parte. Para mantener los **nueve estados** sin ambigüedad, se introduce un **campo `determinationKind` independiente del estado**:

- **`determinationKind: "total"`** — procedencia completa (o negativa completa).
- **`determinationKind: "partial"`** — procedencia mixta.

Reglas:
- El estado `approved` cubre **procedencia total o parcial** (`determinationKind` distingue ambas).
- El estado `denied` queda reservado para **negativa total**.
- Una determinación **parcial** registra, además del `determinationKind`: **alcance aprobado**, **alcance negado**, y para **cada parte negada** una **causa legal** de las del art. 33 (§8.2).
- El flujo de ejecución (`approved → executing → fulfilled`) aplica sobre el **alcance aprobado**; las partes negadas siguen las reglas de comunicación de una negativa (motivo + vías de inconformidad).

### 8.2 Matriz de transiciones permitidas (restringe saltos inválidos)

Sin esta matriz, nada impide saltos inválidos como `received → fulfilled`. Transiciones permitidas (todo lo demás se rechaza):

| Desde | Hacia |
|---|---|
| `received` | `awaiting_information`, `under_review`, `denied` |
| `awaiting_information` | `under_review`, `not_filed` |
| `under_review` | `approved`, `denied` |
| `approved` | `executing` |
| `executing` | `fulfilled` |
| `denied` | `closed` |
| `fulfilled` | `closed` |
| `not_filed` | `closed` |

- `closed` es **terminal** (sólo admite el `delete` de §9.2 cuando vence la retención, que no es un cambio de estado sino una eliminación).
- **`received → not_filed` no existe**: el `not_filed` se alcanza sólo desde `awaiting_information` (la no-presentación se define por **vencer el requerimiento de 10 días**, que requiere haber requerido información antes).
- No existen `received → fulfilled`, ni retrocesos desde estados terminales.

### 8.3 Causas admitidas para una negativa (`denied` o parte negada de una parcial)

Una determinación `denied` (o una parte negada de un `determinationKind: "partial"`) **no** admite texto libre como fundamento. Debe seleccionar **una causa permitida** por la ley (art. 33 LFPDPPP) y después incluir su explicación:

- identidad no acreditada del solicitante;
- los datos no existen en el tratamiento;
- derechos o intereses de terceros en conflicto;
- impedimento legal para acceder, rectificar, cancelar u oponer;
- la solicitud ya fue ejecutada previamente.

La negativa debe comunicar también el derecho a iniciar el **procedimiento de protección** correspondiente.

---

## 9. Semántica operativa de "bloqueo"

> **Corrección frente a versiones previas:** "bloqueo" no es una nota en el expediente; es un estado **operativo** del dato del titular. Corrección también al **dead end técnico** de la retención.

### 9.1 Qué significa que un dato está bloqueado (garantía observable)

Un dato bloqueado:
- **desaparece de búsquedas y operación ordinaria** (no aparece en listados de clientes/pedidos del día a día);
- **no puede utilizarse** para nuevos pedidos, contacto o exportación;
- **no es visible para miembros ordinarios**;
- **sólo puede consultarse** para el motivo legal registrado (ej. obligación fiscal pendiente, disputa);
- **se suprime al vencer** dicho motivo.

Sin esto, "bloqueado" no tiene efecto y la clienta sigue apareciendo normalmente en Store OS.

### 9.2 Ejecución de la eliminación — autorización por regla + ejecución por la dueña

**Autorización (Security Rule es la autoridad):** `delete` sobre `privacyRequests/{id}` se autoriza **únicamente** cuando:
- el solicitante es `ownerUid` de la tienda del expediente, **Y**
- `request.time >= retentionUntil`, **Y**
- no existe `legalHold` activo en el documento.

La UI **sólo refleja** esa decisión; nunca es la barrera.

**Ejecución (la regla autoriza, no ejecuta):** la regla anterior **no hace que el borrado ocurra** — sólo permite a la dueña borrar cuando se cumplen las condiciones. La **responsabilidad de ejecutar** la eliminación al vencer la retención es **de la dueña**, de forma **manual**. El producto la apoya haciendo **observable** el vencimiento:
- la lista de expedientes muestra cuáles tienen `retentionUntil` vencido (y sin `legalHold`) marcados como "listo para supresión";
- la acción de eliminar sólo se habilita en ese caso.
- **No se construye un job automático** en V1 (evita Cloud Functions / costo). El riesgo de que un expediente quede más tiempo del debido se declara en §13 (riesgo residual: la eliminación depende de la dueña).

### 9.3 Eventos que afectan expedientes (abiertos o en retención) — contador autoritativo

- **Eliminar una tienda con expedientes:** **no se permite** `delete` de tienda mientras exista **cualquier** expediente ARCO cuya retención **no haya vencido** o tenga `legalHold` activo — **no sólo** expedientes abiertos. Una tienda con expedientes `closed` aún en retención (24 meses desde `closedAt`, §10) tampoco se elimina. (El bloqueo aplica al **`delete` de tienda**, no a la transferencia de propiedad — ver abajo.)
- **Contador autoritativo y CÓMO baja (corrige el error de versiones previas):** se mantiene un **contador `retainedPrivacyRequestCount`** en el documento canónico de control (`adminStores/{storeId}`, incluido en su allow-list — ver Espec 1 §4 G-P02). Reglas de movimiento:
  - **+1** al **crear** un expediente (en la misma `batched write` que crea `privacyRequests/{id}`, exigida por reglas con `getAfter()`).
  - **−1 únicamente al borrar físicamente** `privacyRequests/{id}` — **en la misma `batched write`** que ejecuta el `delete` del expediente. **Nunca** baja "al vencer" ni "al marcar vencido": bajar antes del borrado físico dejaría un expediente **huérfano** (la tienda ya borrada pero el expediente sin dueña que pueda eliminarlo, porque su `delete` requiere `ownerUid` de una tienda inexistente).
  - Las **Security Rules** aportan la restricción (no la atomicidad): el `delete` de tienda se autoriza sólo si `getAfter(/.../adminStores/$(storeId)).data.retainedPrivacyRequestCount == 0`; la `batched write` aporta la **atomicidad** entre el `delete` del expediente y el decremento del contador. (https://firebase.google.com/docs/firestore/security/rules-conditions , https://firebase.google.com/docs/firestore/manage-data/transactions ).
  - **Prueba en emulador:** crear expediente → contador +1; ejecutar `delete` del expediente en la batched write → contador −1; intentar `delete` de tienda con contador >0 → **denegación**; transferir `ownerUid` con expedientes presentes → **permitido** (no bloqueado por el contador).
- **Transferir `ownerUid`:** el expediente **se reasigna** al nuevo `ownerUid` (no se ve afectado por el contador ni por el bloqueo de `delete` de tienda). **Matiz:** un cambio de UID puede ser sólo un cambio de operadora **dentro de la misma responsable jurídica** (la responsable no cambia); si el cambio implica un **cambio de entidad responsable**, eso requiere un **procedimiento legal distinto** (revisión del ATD y del aviso), no sólo reasignar un campo. El historial registra la transferencia y su tipo.
- **Conservación:** los expedientes se conservan con la tienda; no se eliminan al cambiar de dueña.

---

## 10. Retención V1 (sujeta a validación legal)

Los plazos se cuentan desde un **ancla temporal explícita** en el expediente:
- Solicitud incompleta / no presentada: **90 días desde `notFiledAt`**.
- Expediente cerrado y verificado: **24 meses desde `closedAt`**.
- Evidencia externa de identidad (si se conserva copia cotejada tras validación jurídica): **eliminar 90 días desde `closedAt`**, salvo disputa.
- `legalHold`: **suspende** la eliminación hasta **revisión documentada** (motivo y fecha de revisión); al levantarse, se recalcula `retentionUntil`.
- Datos **bloqueados** por cancelación: conservar hasta la **prescripción** legal o contractual aplicable; después supresión.

`retentionUntil` es el campo que §9.2 evalúa autoritativamente en la regla de `delete`.

> **Principio:** la solicitud ARCO **no** debe convertirse en un archivo eterno de PII.

---

## 11. Permisos de `privacyRequests` y datos del expediente

### 11.1 Permisos (plano de datos)

- `create`, `read`, `update`: **sólo `ownerUid`** de la tienda (la dueña).
- Miembros ordinarios: **sin acceso**.
- `super_admin`: **sin acceso global** (la regla de `privacyRequests` no incluye el short-circuit de `super_admin`; para el resto de colecciones ver Espec 1 GAP-G-P02).
- Eliminación: **sólo** bajo §9.2 (`retentionUntil` cumplido y sin `legalHold`).
- Store OS asiste sólo mediante acceso de soporte autorizado por Olivia (membresía temporal de la tienda). **Esa membresía NO permite abrir `privacyRequests`** — el apoyo de soporte es sobre datos operativos o por acompañamiento a la dueña, nunca acceso directo al expediente ARCO.
- **Sin `privacyManagerUid`** en V1 (era V2 especulativa; eliminada). La dueña como `ownerUid` basta.

### 11.2 Datos mínimos del expediente

Folio y tienda; nombre y canal de respuesta; derecho solicitado y descripción; fechas de recepción y de solicitud completa; estado de identidad y método de verificación; responsable asignado; fechas límite de determinación y ejecución; determinación, motivo y acción ejecutada; sistemas revisados; historial de cambios (fecha + usuario); `retentionUntil` y posible `legalHold`.

### 11.3 Lo que NO se guarda

Copias de identificación; conversaciones completas de WhatsApp; datos de pedidos duplicados; respuestas de acceso completas dentro del expediente.

> **Corrección editorial:** eliminadas las reglas de versiones previas sobre "registrar como clienta toda consulta comercial" y "deduplicar Marías" — **no pertenecen** a prevención de abuso ARCO (la primera contradice minimización).

---

## 12. Prevención de abuso

- **Cero escrituras anónimas a Firestore** (la página pública no crea documentos).
- WhatsApp/correo absorben el spam **antes** de llegar a Store OS.
- La dueña registra toda solicitud reconocible, aunque finalmente no proceda.
- Duplicados se vinculan al mismo expediente.
- Validación de longitud en el campo libre de detalle del expediente (a nivel de UI/cliente, como saneamiento; **no** como garantía de seguridad — la Espec 1 G-P06 declara la validación de esquema fuera de V1).
- Sin archivos adjuntos en Store OS V1.
- Sin API pagada de WhatsApp, **sin CAPTCHA, sin Cloud Functions, sin servicio adicional** (respeta CERO COSTOS).
- La **acreditación de identidad** (§7.3) es la barrera real contra suplantación.

---

## 13. Riesgo residual y no-garantías

- Validez legal final del aviso/ATD/método de identidad **sin revisión jurídica humana** (marcado "sujeto a validación legal").
- Que la dueña siga el procedimiento correctamente (procedimiento humano; el producto organiza el expediente, no decide).
- Cumplimiento GDPR formal (sólo principios inspirados).
- Datos fuera del producto (WhatsApp del dispositivo de Olivia, copias locales) **no** se gobiernan sin acción de la dueña (riesgo de gobernanza, §5).
- Cobertura de procedimientos para representantes/menores más allá del trámite manual V1.
- **Eliminación a tiempo de expedientes vencidos:** la regla **autoriza** el `delete` pero no lo ejecuta (no hay job automático en V1 por cero costos). Un expediente puede permanecer más allá de `retentionUntil` si la dueña no lo borra manualmente. El producto lo hace **observable** (§9.2), pero no lo garantiza a tiempo.

> La spec define el tratamiento y el procedimiento; la **responsabilidad legal de ejecutarlo correctamente es de la responsable** (Olivia, operada por Fer), con Store OS como encargado que organiza y asiste.

---

## 14. Invariantes que tocan el harness (referenciados desde Espec 1)

Estas garantías **no** se redefinen aquí; viven en la Espec 1 con su evidencia:
- Miembro ordinario no lee ARCO → **G-P04**.
- Anónimo no escribe datos privados → **G-P05**.
- ARCO sólo dueña → **G-P04**.
- El cliente no carga telemetría opcional ni hace egress fuera de la allow-list → **G-P08** (+ Espec 1 §3 egress + GAP telemetría §9.4).
- PII de cuentas de usuario legible entre autenticados → **riesgo residual fuera de V1** (Espec 1 §11), no garantía.

La matriz de evidencia vive en la Espec 1 §6.
