# Security Harness — Diseño (Espec 1)

**Fecha:** 2026-08-06
**Autor:** Álvaro González (Product Owner) + Claude (Tech Lead)
**Estado:** Diseño (pendiente de aprobación)

> Complemento de la Espec 2 (Privacidad y ARCO V1). El procedimiento humano ARCO vive allí; aquí sólo invariantes verificables técnicamente. Una sola voz editorial en todo el documento.

> **Nota de vigencia (2026-09-03):** la política de acceso de `super_admin`
> descrita en §3 y G-P02 fue reemplazada por [ADR 0003](../../adr/0003-platform-super-admin-access.md).
> `adminStores` sigue siendo la autoridad de membresía y propiedad, pero el
> `super_admin` tiene acceso operativo global explícito a los datos actuales de
> las tiendas. G-P01 continúa protegiendo a miembros contra cruces entre
> tiendas; las proyecciones públicas y sus allow-lists no cambian.

**Frase rectora.** *Esta spec no afirma que Store OS esté libre de vulnerabilidades. Define las propiedades de seguridad que el producto debe mantener y la evidencia mínima que debe existir antes de liberar un cambio.*

**Regla editorial.** Cada decisión sigue la cadena **amenaza → garantía observable → evidencia → autoridad → fallo → límite**, nunca *herramienta → capacidades anunciadas → promesa*. Toda mención concreta de un escáner (Semgrep, Gitleaks, detect-secrets, eslint-plugin-security, npm audit) vive en el **Apéndice (§10)**. Si una frase con nombre de escáner no se puede mover al apéndice sin cambiar lo que Store OS promete, está confundiendo mecanismo con garantía y debe reescribirse.

---

## 1. Propósito y nivel de afirmación

### Qué promete (sólo dos cosas)

1. **Propiedades de seguridad concretas y verificables del producto** — invariantes en términos de lo que Store OS debe garantizar ante una amenaza, no de qué herramienta las busca. La herramienta que produzca la evidencia es prescindible; la propiedad y la promesa quedan en pie si se cambia.
2. **Que una liberación sin la evidencia exigida será bloqueada** — *fail closed*: si la evidencia mínima de una propiedad no existe, o el mecanismo no pudo producirla, el cambio no se libera. El bloqueo es el estado por defecto cuando falta evidencia.

### Qué NO promete

- **Ausencia total de vulnerabilidades** — absoluto imposible de demostrar; no se reclama.
- **Que la revisión humana sea "determinista"** — dos personas pueden disentir; la revisión aporta juicio, no un veredicto mecánico. El determinismo, donde existe, vive en compuertas de máquina (ej. `design-system-gate.test.ts`).
- **Que "el escáner no encontró nada" signifique "el sistema es seguro"** — cualquier herramienta reporta lo que sabe buscar, no lo que existe. Ausencia de hallazgos es evidencia parcial, nunca garantía.

### Lenguaje

- Válido: "fail closed", "cero bypass silencioso o permanente", propiedades acotadas con evidencia.
- Prohibido: "cero code smells", "100% determinista" (salvo una compuerta de máquina concreta), "imposible de evadir", "verdad objetiva", o cualquier absoluto sin evidencia en el repo.

### Límite de esta sección

Donde una herramienta no existe todavía (no hay generador de cobertura, no hay config de Sonar, no hay CI), esta spec **no inventa una promesa que dependa de ella**. La registra como vacío en el bloque de **Estado actual y GAPs (§9)** y la deja fuera del nivel de afirmación hasta que exista.

---

## 2. Alcance y no-alcance

### En alcance

- **Seguridad del producto** — propiedades que deben ser ciertas para que los datos de tiendas y clientas no se expongan fuera de lo permitido.
- **Seguridad del proceso de liberación** — qué evidencia se exige antes de liberar.
- **Controles de privacidad verificables técnicamente** — invariantes como "un miembro ordinario no puede leer solicitudes ARCO", "el cliente no envía telemetría opcional".

### Fuera de alcance (viven en la Espec 2)

El procedimiento humano de ARCO: quién atiende, plazos legales, retención, redacción del aviso, canal de contacto. Aquí sólo garantizamos, con evidencia técnica, que las reglas son compatibles con ese procedimiento.

### Fuera de alcance (diferido)

DAST/IAST/RASP; analítica/SCD2/B2B-B2C; bitácora de acceso formal (ISO/SOC2).

### Restricción dura

**CERO COSTOS** (free tier). Cualquier control que requiera infra de pago (Cloud Functions continuas, servicios externos pagados) queda fuera.

---

## 3. Modelo de seguridad

### Activos protegidos

Datos privados de tienda (clientes, pedidos, proveedores, compras, costos, inventario, notas privadas), membresías, solicitudes ARCO. (**Cuentas de usuario — riesgo residual:** los datos de `users` son legibles entre autenticados hoy y **no** están protegidos por una garantía en V1; ver §11. Se listan aparte, no como activo con garantía.)

### Actores y roles (reales del producto)

- **Visitante anónimo** — sin sesión; sólo lectura en las tres proyecciones públicas.
- **Titular de datos** — la clienta cuyos datos se tratan.
- **Miembro de tienda** (`member`) — acceso operativo a **una tienda concreta** autorizada por `memberUids`; lee/escribe datos privados sólo de esa tienda.
- **Dueña** (`ownerUid`) — relación por-tienda, **no es un rol**; control total de su tienda (invitar/remover miembros, transferir, eliminar). Figura en `memberUids`.
- **super_admin** — operador privilegiado de plataforma: administra cuentas, tiendas, propietarios y configuración, y puede leer/escribir globalmente los datos operativos actuales de las tiendas (ver [ADR 0003](../../adr/0003-platform-super-admin-access.md)). El acceso global no cambia las allow-lists públicas ni elimina el aislamiento entre miembros.
- **Store OS (operador, encargado)** — da soporte **sólo entrando como miembro autorizado de una tienda concreta**, concedido y revocado por la dueña (visible, revocable, atribuible a la dueña).
- **Google/Firebase** — subencargado.

### Planos (decisión normativa)

- **Plano de CONTROL (`super_admin`):** administración de la plataforma (usuarios, tiendas, quién es dueña de qué, configuración) y operación global de los datos actuales de las tiendas.
- **Plano de DATOS (miembros autorizados de la tienda):** aquí viven los datos privados. El acceso de `member` se concede **por tienda concreta** vía `memberUids`; el `super_admin` es la excepción explícita de plataforma documentada en ADR 0003.

**Acceso de soporte:** Store OS puede operar con el `super_admin` de plataforma o con un miembro autorizado de esa tienda, según el flujo. La capacidad global del `super_admin` no autoriza finalidades propias sobre los datos. El acceso a `privacyRequests` sigue reservado a `ownerUid` hasta que exista una decisión específica.

**Acceso privilegiado de infraestructura (break-glass):** la consola, IAM y el Admin SDK de Firebase **eluden las Security Rules** por diseño. Se reservan para emergencias, recuperación o exigencias legales, con procedimiento: MFA, sin credenciales compartidas, motivo y alcance registrados, notificación a la responsable, no conservar copias innecesarias.

**Promesa correcta sobre break-glass:** *La consola, IAM y Admin SDK no forman parte del acceso operativo normal del producto. El `super_admin` sí tiene acceso operativo global mediante Store OS; el acceso privilegiado de infraestructura se reserva para incidentes, recuperación o requerimientos legales, con motivo documentado y notificación a la responsable.*

### Datos por clase

- **Públicos:** exclusivamente las proyecciones `publicStores`, `publicCatalogs`, `publicProducts`. Cada una enumera una **allow-list explícita** de campos; no esparce el objeto fuente. Campos privados (`cost`, `privateNotes`, `quantityOnHand`, `prices.wholesale`, `prices.reseller`, `ownerUid`, `memberUids`) no se proyectan; `availableQuantity` es la única cifra de inventario pública y está publicada deliberadamente para limitar pedidos.
- **Privados:** colecciones internas restringidas por membresía (`stores`, `products`, `categories`, `suppliers`, `purchases`, `customers`, `orders`, `slugs`, `privacyRequests`).
- **Administrativos:** `slugs`, membresía. (**`users` — riesgo residual §11:** no membership-gated; legible entre autenticados. No entra en las garantías G-P de V1.)

### Fronteras de confianza

- **Cliente** — no confiable. El filtrado en cliente (selectores, `where storeId`) es **sólo UX, nunca frontera de seguridad**.
- **Firestore Security Rules** — **frontera autoritativa**.
- **Admin SDK / consola / IAM** — elude las reglas; break-glass (arriba).

### Superficies de entrada y salida (egress autorizado V1)

Destinos externos autorizados: **Firebase** (operación), **Vercel** (servir la aplicación: metadatos técnicos de petición — IP, user-agent, ruta, logs necesarios para servir), **WhatsApp** (sólo navegación iniciada por la persona vía `wa.me`). **El cliente no envía telemetría opcional a servicios de analítica** (V1 no carga Web Analytics ni Speed Insights — ver Espec 2, mapa de tratamiento, y la memoria de decisión).

> Nota: la afirmación "wa.me es el único egress" y "cero analytics en la ruta pública" son **FALSAS** en versiones previas de este documento. Firebase y Vercel son destinos de red reales. La garantía precisa es la del párrafo anterior.

---

## 4. Garantías del producto

Pocas, estables, como **resultados observables**. Cada una: Garantía / Alcance / Evidencia obligatoria / Autoridad / Activación / Límites.

### G-P01 — Aislamiento entre tiendas

- **Garantía:** una persona miembro de una tienda no puede leer ni modificar datos privados de otra tienda a la que no pertenece, aunque conozca los identificadores de los documentos.
- **Alcance:** todas las colecciones privadas con `storeId` (products, categories, suppliers, purchases, customers, orders) y los documentos de `stores`.
- **Evidencia obligatoria:** matriz de acceso cruzado contra las reglas cargadas en emulador — (a) miembro de tienda A hace `get`/`list` sobre un documento privado de tienda B por su id conocido y obtiene **denegación**; (b) intento de `create`/`update`/`delete` con `storeId` ajeno obtiene **denegación**; (c) el mismo miembro sobre documentos de su tienda obtiene **éxito** (control positivo).
- **Autoridad:** si la matriz no se ejecuta, o cualquier cruce A→B retorna permiso, **el cambio no se libera**.
- **Activación:** cambios en auth, `firestore.rules`, membresía (`memberUids`/`ownerUid`), el adaptador de acceso a datos (`firestoreData.ts`) o la estructura de documentos.
- **Límites:** no cubre credenciales robadas de un miembro legítimo, cuentas comprometidas, ni el plano administrativo de Google/Firebase. No cubre fuga lateral por `memberUids` mal asignados por la dueña (decisión humana).

### G-P02 — super_admin no obtiene acceso al plano de datos por su rol (histórico)

> Este bloque conserva la garantía original de Espec 1 para trazabilidad, pero
> ya no es el contrato vigente. La política actual concede acceso operativo
> global al superadmin y está documentada en [ADR 0003](../../adr/0003-platform-super-admin-access.md).

- **Garantía:** el rol `super_admin` **no da, por sí mismo, acceso de lectura ni escritura a ningún dato del plano de datos de las tiendas**: customers, orders, products, categories, suppliers, purchases, privateNotes, ni solicitudes ARCO. La administración de plataforma y el acceso a PII son **planos separados**. Lo que `super_admin` puede leer es un **conjunto declarado de metadatos de control** — nunca el contenido de negocio ni los datos personales de clientas.
- **Alcance:** todas las colecciones de datos privados, incluida `categories` (`products`, `categories`, `suppliers`, `purchases`, `customers`, `orders`), `stores` y `privacyRequests`.
- **Realización técnica (normativa, no opcional) — `adminStores` es el documento CANÓNICO del plano de control:** Firestore **no puede ocultar campos en una lectura** — devuelve el documento completo o nada (https://firebase.google.com/docs/firestore/security/rules-fields). El documento `stores` actual **mezcla** metadatos de control (`ownerUid`, `memberUids`, `pendingInvites`) con contenido de negocio (`whatsappPhone`, `skuPrefix`, `storefront`) — ver `src/types/index.ts:6-25`. Por tanto la separación es **física** y `adminStores/{storeId}` es la **fuente canónica del plano de control** (no una proyección derivada que pueda desincronizarse):
  - **Campos exactos permitidos en `adminStores` (allow-list cerrada):** `storeId`, `name`, `slug`, `type`, `ownerUid`, `memberUids`, `pendingInvites`, `createdAt`, `updatedAt`, y `retainedPrivacyRequestCount` (contador de control de expedientes ARCO en retención — ver Espec 2 §9.3). Todos son **metadatos de control**, nunca contenido de negocio ni PII de clientas.
  - **Exclusiones absolutas (NUNCA en `adminStores`):** `whatsappPhone`, `skuPrefix`, `storefront`, y cualquier contenido de negocio o PII de clientas.
  - **`adminStores` es la única fuente de autoridad para membresía/propiedad:** si `adminStores` es canónico, `isMember`/`isOwner` **confían exclusivamente en él** (`getAfter(/databases/.../adminStores/$(storeId))`). Cualquier copia de `ownerUid`/`memberUids` que viva en `stores` es **derivada**, no una segunda fuente de autoridad — las reglas no la consultan para autorizar acceso a datos privados.
  - **Autoridad de escritura:** `adminStores` lo escribe el sistema **en la misma operación** que crea/actualiza `stores` (regla que exige la escritura conjunta vía `getAfter()`, o el client adapter en una `batched write` atómica), de modo que no haya ventana de desincronización. La dueña (`ownerUid`) y `super_admin` pueden `read`; sólo `ownerUid` (o el sistema en escritura conjunta) puede `write`. `super_admin` **no lee `stores` directamente** salvo que también sea miembro de esa tienda.
  - **Integridad (evidencia de no-desincronización):** prueba que, tras crear/editar una tienda, `adminStores/{id}` y `stores/{id}` coinciden en los campos compartidos (`ownerUid`, `memberUids`, `pendingInvites`, `name`, `slug`, `type`); si difieren, **falla**.
- **Evidencia obligatoria:** (a) prueba negativa — `super_admin` no-miembro intenta `get`/`list` de `stores`, `products`, `categories`, `suppliers`, `purchases`, `customers`, `orders` y `privacyRequests` de tienda ajena → **denegación**; (b) control positivo — `super_admin` lee `adminStores` (sólo allow-list de control); la dueña lee el `stores` completo de su tienda; (c) prueba de allow-list de `adminStores` — sus claves son exactamente las declaradas y las exclusiones no aparecen; (d) prueba de integridad de sincronización `adminStores`↔`stores`.
- **Autoridad:** si la prueba no se ejecuta o `super_admin` obtiene PII o contenido de negocio por su rol, **el cambio no se libera**.
- **Activación:** cambios en `isSuperAdmin`/`isMember`/`isOwner`, en el short-circuit de esas funciones, en las reglas de datos privados, en `firestoreData.ts`, o en la estructura de `stores`/`adminStores`.
- **Estado (implementado en Espec 1):** la garantía **se cumple** tras la implementación de Espec 1. Históricamente `isSuperAdmin()` hacía short-circuit al inicio de `isMember`/`isOwner` y el cliente leía la vista-dios, de modo que `super_admin` leía TODA la PII de TODAS las tiendas — ese era el GAP de migración (no una facultad aceptada ni un riesgo contratado). La implementación lo cerró: (a) `adminStores` canónico con la allow-list declarada, (b) `isMember`/`isOwner` ya no short-circuit en `isSuperAdmin` y leen `adminStores`, (c) `super_admin` lee control sólo vía `adminStores`, (d) `adminStores` se escribe atómicamente con `stores` en una `writeBatch`, y (e) las ediciones de contenido de negocio en la UI se gatean en `ownerUid`, no en el rol `super_admin`. Ver §9 y los commits de implementación.
- **Límites:** no cubre a una persona `super_admin` que **también** sea dueña o miembro legítima de una tienda (ahí accede por su relación de tienda, no por rol — correcto). No cubre consultas de soporte autorizadas explícitamente por la dueña caso por caso (vía membresía de esa tienda, nunca vía rol).

### G-P03 — Sólo se publican campos expresamente permitidos

- **Garantía:** las proyecciones públicas (`publicStores`, `publicCatalogs`, `publicProducts`) contienen **exclusivamente** una allow-list declarada. Ningún campo privado llega al catálogo público. No se vuelca el objeto fuente.
- **Alcance:** `projectPublicStore`, `projectPublicProductDetail`, `projectPublicProductSummary` (`firestoreData.ts:257-340`).
- **Evidencia obligatoria:** prueba de allow-list — dado un `Store`/`Product` fuente que **sí contiene** campos privados (`cost`, `prices.wholesale`, `prices.reseller`, `privateNotes`, `quantityOnHand`, `ownerUid`, `memberUids`), la proyección devuelve un objeto cuyas claves son exactamente la allow-list y los campos privados **no aparecen** (comparación de claves). La prueba **falla** cuando: (a) aparece una clave no permitida en la **salida**; (b) el proyector esparce el objeto fuente (`...source`) en lugar de enumerar campos; (c) se modifica la allow-list sin una decisión normativa que lo justifique. (Nota: agregar un campo privado al fuente **no** debe hacer fallar la prueba — en una proyección segura la salida no cambia.) Más prueba de reglas: la lectura anónima sólo se permite en las tres colecciones públicas (`firestore.rules:144-171`); el resto niega por defecto a no autenticados.
- **Autoridad:** si la prueba falla o no se ejecuta, **el cambio no se libera**.
- **Activación:** cambios en proyecciones, en los types de `Product`/`Store`, o en los projectores.
- **Límites:** no cubre un error humano futuro que agregue un campo a la allow-list sin pensar (la prueba lo atrapa como regresión). No cubre campos que la dueña decida legítimamente publicar.

### G-P04 — Sólo la dueña accede a solicitudes ARCO

- **Garantía:** las solicitudes ARCO de una tienda sólo las lee la dueña de esa tienda (`ownerUid`). Miembros ordinarios (incluso de la misma tienda), `super_admin` y anónimos **no** pueden leerlas ni escribirlas.
- **Alcance:** la colección `privacyRequests` (pendiente de crear).
- **Evidencia obligatoria:** matriz {dueña, miembro de la misma tienda, miembro de otra tienda, `super_admin`, anónimo} × `privacyRequests` que afirma **permiso únicamente para la dueña** y **denegación** para los demás, en lectura y escritura.
- **Autoridad:** si la matriz falla o no se ejecuta, **el cambio no se libera**.
- **Activación:** cambios en el flujo de privacidad, en las reglas de `privacyRequests`, o en la lógica de membresía.
- **Límites:** no cubre a la dueña que actúa maliciosamente dentro de su propia tienda (es la responsable del tratamiento; ver Espec 2).

### G-P05 — Ninguna persona anónima escribe datos privados

- **Garantía:** una persona sin sesión sólo puede **leer** las tres proyecciones públicas. No puede escribir en ninguna colección, pública ni privada.
- **Alcance:** todas las colecciones.
- **Evidencia obligatoria:** prueba de reglas — `create`/`update`/`delete` anónimo es denegado en todas las colecciones (incluidas las públicas); `read` anónimo sólo se permite en las tres públicas.
- **Autoridad:** si falla o no se ejecuta, **el cambio no se libera**.
- **Activación:** cambios en reglas de escritura o de lectura anónima.
- **Límites:** la lectura anónima del catálogo público es pública por diseño (no es una fuga).

### G-P06 — Escrituras fuera de membresía o con storeId inconsistente son rechazadas

- **Garantía:** las reglas niegan `create`/`update`/`delete` que no satisfagan membresía sobre el `storeId` afectado, y niegan `update` que cambie el `storeId` del documento o que lo haga inconsistente entre `resource` y `request.resource`.
- **Alcance:** colecciones de entidades con `storeId`.
- **Evidencia obligatoria:** pruebas de reglas — `update` con `storeId` alterado es denegado; `create`/`update` sin membresía sobre ese `storeId` es denegado; `update` con `resource.data.storeId == request.resource.data.storeId` y membresía es permitido.
- **Autoridad:** si falla o no se ejecuta, **el cambio no se libera**.
- **Activación:** cambios en reglas de escritura.
- **Nota de precisión:** HOY las reglas validan **membresía e invariancia de `storeId`**, **no** validan tipos, claves permitidas ni longitudes de campos. La garantía se refiere a lo que las reglas hacen hoy; la validación de esquema (tipos/claves/longitudes) **no** se promete en V1 y, si se desea, es trabajo de implementación futuro. No afirmar que las reglas validan "esquema esperado" más allá de `storeId`+membresía.
- **Límites:** no cubre validación de contenido (tipos, claves, longitudes) — fuera de V1.

### G-P07 — Secretos y credenciales administrativas no llegan al cliente

- **Garantía:** no hay service-account keys, tokens de admin, ni config sensible en el bundle cliente ni en el árbol del repo. La config pública de Firebase (`apiKey`, `projectId`, etc.) es segura por diseño: el acceso se controla con reglas, no ocultando keys.
- **Alcance:** `src/main.tsx`, bundle, `.env*`, árbol del repo.
- **Evidencia obligatoria:** inspección de repositorio (no hay `service-account*.json`, no hay `FIREBASE_*` privadas en `.env*` commiteadas) + inspección de build (la config del cliente sólo lleva `VITE_FIREBASE_*` públicas).
- **Autoridad:** si se halla un secreto/admin credential, **el cambio no se libera**.
- **Activación:** todos los cambios.
- **Límites:** la config pública de Firebase en el cliente es por diseño y no es una vulnerabilidad.

### G-P08 — El cliente no carga telemetría opcional

- **Garantía (acotada con honestidad):** el cliente no carga SDKs de telemetría de analítica ni de RUM (`@vercel/analytics`, `@vercel/speed-insights`) ni realiza **egress de red a destinos no autorizados**. Los únicos destinos externos autorizados son Firebase (operación), Vercel (servir la app) y WhatsApp (navegación iniciada por la persona). **No** se promete "ni equivalentes" de forma abierta — se promete lo verificable: ausencia de esos paquetes/imports **y** que todo `fetch`/`sendBeacon`/XHR del bundle apunte sólo a la allow-list de destinos autorizados.
- **Alcance:** `src/main.tsx`, dependencias (`package.json`), árbol de routing, bundle, configuración de hosting.
- **Allow-list de destinos (normativa) y rutas prohibidas same-origin:**
  - **Hosts permitidos:** `firestore.googleapis.com` (y el host de Auth/Firebase que use la app, ej. `identitytoolkit.googleapis.com`/`*.firebaseapp.com`), el origen same-origin **sólo para recursos de la aplicación** (HTML/JS/CSS/imagenes del catálogo y del admin), y `wa.me` (navegación iniciada por la persona).
  - **Rutas same-origin PROHIBIDAS explícitamente:** `/__vercel/insights/**` y `/_vercel/insights/**` (telemetría de Web Analytics/Speed Insights), y cualquier endpoint de telemetría conocido. Permitir "Vercel para servir" genéricamente **no** abre estas rutas: se niegan por patrón.
- **Evidencia obligatoria (dos frentes, ambos requeridos):**
  - **(a) Ausencia estática:** no `@vercel/analytics` ni `@vercel/speed-insights` en `package.json`; sin imports/componentes de los mismos en el árbol; inspección del bundle sin sus chunks.
  - **(b) Egress observable — prueba RUNTIME obligatoria (no "o estática"):** interceptación de red en Playwright sobre las rutas pública **y** autenticada que verifica que **toda** petición de red (incluidas `sendBeacon`/`fetch`/XHR) cae en los hosts permitidos; cualquier petición a `/__vercel/insights/**`, `/_vercel/insights/**`, o a un host fuera de la allow-list → **falla**. La prueba runtime es obligatoria porque la estática no ve rutas same-origin generadas dinámicamente.
- **Autoridad:** si aparece un paquete/import prohibido **o** un egress fuera de la allow-list **o** una petición a una ruta de telemetría prohibida, **el cambio no se libera**.
- **Activación:** cambios en dependencias, `src/main.tsx`, routing, hosting, o cualquier código que añada llamadas de red (`fetch`/`sendBeacon`/XHR/websocket).
- **Estado (implementado en Espec 1):** la garantía **se cumple**. Históricamente `@vercel/analytics` y `@vercel/speed-insights` estaban montados globalmente en `src/main.tsx:3-4` (en TODAS las rutas); la implementación de Espec 1 los retiró por completo, añadió una compuerta estática (ausencia de paquetes/imports/rutas) y una prueba runtime de egress en Playwright (ver Espec 2 §5.2-5.3 y la memoria de decisión).
- **Límites:** no cubre metadatos técnicos de petición que el hosting (Vercel) procesa por necesidad para servir la app (eso no es telemetría de producto; ver Espec 2 §5.3). La allow-list de destinos es la fuente normativa; añadirla es una nueva decisión (§3).

### G-P09 — Las solicitudes públicas no pueden inflar pedidos ni saltarse el inventario

- **Garantía:** el navegador sólo puede solicitar productos publicados de esa tienda, con nombre obligatorio y cantidades enteras dentro de los límites. La callable recalcula precios y escribe una orden `requested`; no reserva inventario hasta la aceptación de la dueña.
- **Controles:** idempotencia por solicitud, límite por navegador (5 min), por IP (1 min) y fusible global de 500 solicitudes por día UTC. `publicOrderLimits` contiene sólo hashes y tiene TTL; las reglas niegan todo acceso de cliente.
- **Evidencia obligatoria:** prueba contra el emulador de una solicitud válida, reintento idempotente, exceso de inventario, publicación/tienda inválida y bloqueo de límites; prueba de reglas que niega lectura/escritura anónima en `publicOrderLimits`.
- **Límites:** son controles de abuso y crecimiento de registros, no una defensa DDoS volumétrica ni sustituyen WAF/CDN o App Check si el tráfico lo exige.

> **PII de cuentas de usuario — fuera de alcance en V1 (declarado, no resuelto).** La colección `users/{uid}` permite `read` a **cualquiera autenticado** (`firestore.rules:40-41`): email, displayName y rol de cualquier usuario son legibles por cualquier sesion. **No existe una garantía G-P que lo impida en V1.** Se declara explícitamente como **riesgo residual (ver §11)**, no como GAP oculto. Si se desea proteger (probablemente con un directorio mínimo separado análogo a `adminStores`), sería una nueva garantía **G-P10** en una versión posterior; no entra en V1.

> **No se incluye "cero code smells" como garantía** — no es una garantía de seguridad del producto.

---

## 5. Garantías del harness (el sistema de evidencia)

### G-H01 — Cada cambio recibe las verificaciones aplicables a su superficie
No todas las verificaciones a todos los cambios; el mapeo superficie→verificación está en §7.

### G-H02 — Evidencia ausente, incompleta o de resultado desconocido cuenta como fallo (fail closed)
La ausencia de evidencia nunca se interpreta como aprobación.

### G-H03 — CI es la autoridad para integrar; el despliegue es la autoridad final; el pre-commit sólo ofrece feedback
Un hook local nunca puede ser autoridad: `git commit --no-verify` lo evita y eso **no** queda registrado de forma detectable por un reviewer en el log de git. El pre-commit es feedback temprano, no compuerta.

### G-H04 — Un fallo obligatorio bloquea la integración o el despliegue

### G-H05 — Excepciones, pero no sobre las garantías del producto
**Distinción obligatoria:**
- **Garantías del producto (G-P01–G-P09): no renunciables.** La falta de evidencia de una de ellas **bloquea producción, sin excepción administrativa**. No se puede aceptar el riesgo de aislamiento roto, PII pública, `super_admin` con acceso a datos, telemetría no autorizada o crecimiento abusivo de pedidos.
- **Mecanismo de evidencia sustituible:** puede reemplazarse por evidencia equivalente (ej. otro test que produzca la misma matriz de acceso) — esto no es una excepción a la garantía, es cambiar la herramienta.
- **Advertencias (hallazgos bajos/medios, code smells, deuda):** pueden documentarse temporalmente con vencimiento.
- Una excepción documentada (sólo sobre advertencias, nunca sobre G-P0x) indica **alcance, motivo, responsable y vencimiento**. "Cero bypass silencioso o permanente" — no "cero bypass".

### G-H06 — Cada resultado identifica versión de reglas, configuración y commit
Reproducible.

### G-H07 — Las revisiones humanas se registran como juicio humano, no como prueba determinista

---

## 6. Contrato de evidencia

| Garantía | Evidencia obligatoria | Autoridad | Cuándo se exige |
|---|---|---|---|
| G-P01 | Matriz de acceso cruzado tienda A vs B (denegación con IDs conocidos; control positivo sobre la propia) | CI | Cambios en auth, reglas, membresía, adaptador de datos, estructura de documentos |
| G-P02 | Prueba negativa: `super_admin` no-miembro leyendo stores/products/categories/suppliers/purchases/customers/orders/privacyRequests de tienda ajena → denegación; control positivo (dueña lee su `stores`; `super_admin` lee `adminStores`); allow-list exacta de `adminStores`; integridad de sincronización `adminStores`↔`stores` | CI | Cambios en roles, short-circuit de isSuperAdmin, reglas de datos privados, estructura de stores/adminStores |
| G-P03 | Prueba de allow-list de proyecciones (claves exactas en la SALIDA; falla si aparece clave prohibida, si el proyector esparce el fuente, o si la allow-list cambia sin decisión) + prueba de reglas de lectura anónima acotada a 3 colecciones | CI | Cambios en proyecciones, types Product/Store, projectores |
| G-P04 | Matriz {dueña, miembro mismo/otra tienda, super_admin, anónimo} × privacyRequests → sólo dueña | CI | Cambios en privacidad, reglas privacyRequests, membresía |
| G-P05 | Prueba de reglas: escritura anónima denegada en todas; lectura anónima sólo en 3 públicas | CI | Cambios en reglas de escritura/lectura anónima |
| G-P06 | Prueba de reglas: update que cambia storeId denegado; sin membresía denegado; invariante storeId+membresía permitido | CI | Cambios en reglas de escritura |
| G-P07 | Inspección de repo + build: sin service-account ni credenciales admin; sólo VITE_FIREBASE_* públicas | CI | Todos los cambios |
| G-P08 | (a) Ausencia estática de `@vercel/analytics`/`@vercel/speed-insights`; (b) prueba **runtime** en Playwright (rutas pública y autenticada) con todo destino en la allow-list y **negación explícita** de `/__vercel/insights/**`, `/_vercel/insights/**` y hosts ajenos | CI | Cambios en dependencias, main.tsx, routing, hosting, o llamadas de red nuevas |
| G-P09 | Pruebas de callable contra emulador: validación de nombre/ids/cantidades, publicación/tienda, inventario, idempotencia, ventanas navegador/IP y fusible diario; reglas niegan `publicOrderLimits` al cliente | CI/emulador | Cambios en checkout público, callable, reglas, inventario o índices TTL |

> Una marca verde significa **que existe evidencia aceptable** para esa garantía en ese cambio; nunca "cumplimiento garantizado por la herramienta".

---

## 7. Selección y activación de verificaciones

**Superficies lógicas** (no herramientas): autorización; datos privados; proyección pública; dependencias; build cliente; configuración de despliegue.

Cada superficie tiene un conjunto de verificaciones aplicables (definidas por la evidencia de §6). Ante la duda sobre qué superficie toca un cambio, se ejecuta el **conjunto más amplio**. No se nombran escáneres aquí (van al apéndice).

---

## 8. Fallos y excepciones

- **Bloquea:** un must_pass que falla; evidencia ausente/desconocida; un hallazgo de severidad crítica/alta explotable confirmado; **siempre** la falta de evidencia de una garantía G-P0x (no renunciable).
- **Advierte:** hallazgos bajos/medios; code smells; deuda técnica — se reportan, no bloquean (YAGNI aplica).
- **Herramienta que no puede ejecutarse:** la garantía asociada **falla cerrada** si no hay evidencia equivalente. Una herramienta caída nunca convierte "no se pudo verificar" en "aprobado".
- **Aceptar riesgo:** un humano (Product Owner / responsable). El agente nunca auto-aprueba. Y **sólo sobre advertencias**, nunca sobre G-P01–G-P09.
- **Excepción:** tiene vencimiento; al vencer, la garantía vuelve a exigirse. Exige control compensatorio mientras vive.
- **Lenguaje:** "cero bypass silencioso o permanente" (no "cero bypass" ni "imposible de evadir").

---

## 9. Estado actual y GAPs (separado de las garantías normativas)

Lo que la spec **promete** vive en §4–§5. Lo que **existe hoy** vive aquí. No mezclar.

### 9.1 Lo que ya existe y sirve como base

- Proyecciones públicas con allow-lists explícitas enumeradas (`firestoreData.ts:257-340`) — G-P03 ya es cierto por construcción; le falta **test formal** (hoy hay tests de projectores en `firestoreData.test.ts:51-134`, pero no la prueba de allow-list como compuerta).
- Lectura anónima acotada a 3 colecciones (`firestore.rules:144-171`); privadas default-deny a anónimo — base de G-P05.
- `@firebase/rules-unit-testing` **instalado** — base para G-P01/P02/P04/P05/P06.
- Modelo de compuerta determinista en vitest: `design-system-gate.test.ts` (pure Node, glob + `expect(offenders).toEqual([])`).
- Guard de escalación: sólo `admin@store.os` verificado puede ser `super_admin` (`firestore.rules:28-38`).

### 9.2 GAPs (la garantía existe como norma, pero NO se cumple hoy)

- **GAP-G-P01 / G-P02 / G-P06:** la suite de `firestore.rules` ya existe en `src/app/firebase/firestore.rules.test.ts` y se ejecuta con `npm run test:rules`; G-P04 y `privacyRequests` siguen siendo trabajo futuro. El aislamiento y el acceso global vigente se prueban contra el emulador, además de los tests de selectores/render/projectors.
- **GAP-G-P02 (histórico) — RESUELTO bajo la decisión vigente:** la separación estricta del superadmin respecto al plano de datos fue reemplazada por [ADR 0003](../../adr/0003-platform-super-admin-access.md). Hoy `isSuperAdmin()` autoriza la operación global explícita en las reglas; `adminStores` conserva la autoridad canónica de membresía/propiedad y las proyecciones públicas siguen siendo allow-lists. Las pruebas cubren tanto el acceso global del superadmin como el aislamiento de miembros.
- **GAP-bootstrap:** `auth.ts:46` asigna `super_admin` al primer signup (colección vacía), pero `firestore.rules:46-48` exige `admin@store.os` verificado. En producción ganan las reglas. Documentar como desviación conocida y cubrirla con prueba.
- **GAP-G-P06 precisión:** las reglas validan membresía + invariancia de `storeId`, **no** esquema (tipos/claves/longitudes). No prometer validación de esquema en V1.
- **GAP-invitaciones:** cualquier miembro (`isMember`) puede hacer `get` de `stores/{id}` **completo**, incluido `pendingInvites` con emails (`firestore.rules:54-55`). La afirmación "sólo dueña y super_admin ven los emails de invitación" es **falsa**. Si se desea restringir, es trabajo de implementación (no parte de G-P0x salvo que se añada una garantía).

### 9.3 Lo que NO existe (diseño futuro, no "implementación actual")

**Importante — corrección al error de versiones previas:** Gitleaks, Semgrep, `detect-secrets`, `eslint-plugin-security`, config de Sonar, `.github/workflows` y `husky` **no están instalados ni configurados**. No existen `.gitleaks*`, `.semgrep*`, `sonar-project.properties`, ni `.husky/`. **No hay CI.** Llamarlos "implementación actual V1" era falso. Su estado real es "propuesto / no implementado". Viven en el Apéndice (§10) como **binding propuesto**, no como hecho.

Tampoco existe generador de cobertura (ni `@vitest/coverage-*`, c8, istanbul) ni config de Sonar → **no se promete cobertura ni quality-gates de Sonar en V1**.

### 9.4 Decisión V1 sobre telemetría (afecta el modelo de seguridad)

`@vercel/analytics` + `@vercel/speed-insights` están montados globalmente en `src/main.tsx:3-4` (en TODAS las rutas, incluido el catálogo público). **V1 los retira por completo** del árbol de montaje y de las dependencias (ver Espec 2, mapa de tratamiento, y la memoria de decisión). Hasta que se retiren, la afirmación "el cliente no envía telemetría opcional" es **norma, no realidad** — el GAP se cierra en implementación.

---

## 10. Apéndice reemplazable de herramientas

**Único lugar donde aparecen nombres de escáner.** Cambiar una herramienta **no** modifica las garantías mientras produzca la misma evidencia.

| Capacidad requerida | Binding propuesto (V1) | Configuración | Estado actual | Sustituible |
|---|---|---|---|---|
| Detectar secretos en el código fuente (config Firebase pública es legítima → baseline) | **Gitleaks** (uno solo; no duplicar con detect-secrets en V1) | config versionada | **No implementado** (no instalado, no config) | Sí |
| Probar autorización y aislamiento (matriz de acceso) | Emulador Firebase + `@firebase/rules-unit-testing` | tests co-localizados | **Dependencia instalada, tests ausentes** | Sí |
| Analizar dependencias con CVE conocido alto/crítico | `npm audit --audit-level=high` | package-lock | **No automatizado** (npm audit existe, sin gate) | Sí |
| Detectar patrones de código inseguro (XSS, inyección, OWASP Top 10) | Semgrep (rulesets owasp/js/ts/react) | `.semgrep.yml` | **No implementado** | Sí |
| Validación de esquema (tipos/claves/longitudes) | — | — | **No existe; fuera de V1** | — |
| Cobertura de pruebas | — | — | **No existe generador; fuera de V1** | — |
| Análisis de deuda técnica / complejidad (opcional, local) | SonarQube local (docker) o SonarQube for IDE | — | **No implementado; opcional, nunca gate** | Sí |

**Decisiones de V1 sobre el conjunto:**
- **Un solo detector de secretos:** Gitleaks. No añadir `detect-secrets` en V1 (solapamiento).
- **`eslint-plugin-security` fuera en V1:** es ruidoso y se solapa con Semgrep. El conjunto mínimo V1 es: **reglas Firebase + pruebas de proyección + Gitleaks + `npm audit` + Semgrep**.
- **SonarQube/Sonar "sin server bloqueando por calidad y cobertura" NO existe en esa modalidad:** SonarScanner evalúa contra SonarQube Cloud/Server (ahí viven los quality gates) y la cobertura la **importa** de un reporte externo (no la calcula). Por tanto **no se diseña ninguna garantía alrededor de SonarCLI-sin-server**. Si se quiere análisis de deuda/complejidad, queda como herramienta **local opcional** que el desarrollador corre cuando quiera ver salud del código — **nunca gate autoritativo**, nunca parte del contrato de evidencia.

---

## 11. Riesgo residual y no-garantías

El harness NO demuestra:
- Ausencia absoluta de vulnerabilidades.
- Seguridad ante cuentas comprometidas (credenciales robadas, phishing a la dueña).
- Seguridad del plano administrativo de Google/Firebase (quien controla el proyecto elude las reglas vía consola/IAM/Admin SDK).
- Cumplimiento de procedimientos humanos (que la dueña siga el ARCO correctamente).
- Detección de TODAS las filtraciones semánticas (tests y revisión atrapan lo conocido; no son exhaustivos).
- Validez indefinida de las bases de vulnerabilidades (CVEs nuevos aparecen).
- **PII de cuentas de usuario entre usuarios autenticados:** `users/{uid}` es legible por cualquier sesion (`firestore.rules:40-41`). V1 no lo protege; sería G-P10 futura.

El harness **eleva el piso de confianza y hace observable la evidencia**; no garantiza perfección.
