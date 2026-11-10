# CLAUDE.md

Guía para trabajar en Store OS. Lee esto antes de empezar.

@LOOPS.md

## Flujo de entrega

Un cambio = una rama desde `main` = un draft PR (la spec, si la hay, viaja dentro del mismo PR). Ver `LOOPS.md`. Autonomía permitida: rama, commits, push de rama, draft PR, CI, Preview, y —bajo la autorización permanente del PO (2026-11-08)— merge y liberación a producción, siempre con CI completo en verde, revisión independiente sin contexto del PR y release guard (versión + notas). Nunca push directo a `main` ni leer/escribir datos productivos.

## Gestión del trabajo

El acuerdo vigente del proceso está en el README del tablero Store OS. Prevalece
sobre documentos históricos para organización, estados y evidencias. El feedback
se refina en issues, sin PR de documentación por cada solicitud; las áreas son
permanentes y las épicas tienen objetivos finitos. Solo se asignan historias
Listo; al tomar una se registra responsable y worktree. Para producto, merge
significa Por liberar; la liberación a producción cierra la historia como
Hecho, sin ronda adicional de aceptación. Defectos o ajustes posteriores nacen
como items nuevos.

La cola vive en el tablero "Store OS" de [GitHub Projects](https://github.com/users/imalvaroglez/projects/1)
(issues + PRs; Status nativo con estados en español / Prioridad / Tipo / Ciclo). La issue es la unidad de
trabajo: criterios de aceptación en su cuerpo. La spec de archivo es excepcional
(decisiones de arquitectura o reglas de negocio) y viaja dentro del PR. Los agentes
consultan y actualizan el tablero con `gh project` / `gh issue`; si `gh` falla,
preguntan. Ver `docs/superpowers/specs/2026-11-01-github-projects-board-design.md`.

## Qué es Store OS

PWA **cloud-first**, **mobile-first** y **100% en español (México)** para administrar tiendas pequeñas. Firebase Auth y Firestore respaldan la administración. Multitienda, dos tipos de tienda (Bajo pedido / Inventario y precios). Ver [`README.md`](README.md) y [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Stack: **React 18 + TypeScript + Vite + Tailwind + Firebase**, PWA. `localStorage` se reserva para preferencias, carrito público y borradores asociados a una persona autenticada; nunca sustituye la persistencia administrativa.

## Comandos

```bash
npm run dev            # desarrollo (5173) — Firebase store-os-dev o emuladores locales
npm run build          # tsc --noEmit + vite build
npm run typecheck      # tsc --noEmit
npm run test           # vitest (unit + design-system gate)
npm run test:rules     # pruebas de firestore.rules contra el emulador (G-P01/G-P02/G-P05/G-P06)
npm run e2e            # playwright frontend (smoke + responsive + theme, móvil + escritorio)
npm run e2e:firebase   # pruebas contra el emulador Firebase (requiere `npm run emulators`)
npm run emulators      # Firebase Auth + Firestore emuladores en localhost
npm run preview        # build de producción
```

No declares algo "listo" sin evidencia: antes de abrir el PR, `npm run typecheck && npm run test && npm run build` en verde, y e2e cuando el diff lo amerite.

## Validación de Preview

Para validar la interfaz, las rutas y el flujo público usa el build de producción local: `npm run build` y después `npm run preview` en localhost. Para esta PWA estática de Vite, ese servidor local es la referencia de Preview; no detengas una entrega esperando una Preview externa de Vercel. Si Vercel falla por credenciales o configuración, repórtalo aparte de la validación funcional.

## Promoción de Preview a producción

`store-os-dev` es el único destino para desarrollo, pruebas y Preview. `store-os-f7cf8` es producción y solo recibe releases vía CI — ejecutados por una persona o por el agente bajo la autorización permanente del PO (2026-11-08), con CI completo en verde, revisión independiente sin contexto y release guard. El mismo commit revisado en el PR y la rama `main` es el que se libera; no se copia código manualmente. Si una validación o reparación actualiza proyecciones públicas en dev, documenta el paso equivalente para la liberación. Nunca copies el seed ni datos sintéticos de dev a producción.

**Excepción Sev-1 (declarada por el PO; ver `docs/runbook-sev1-hotfix.md`):** durante un incidente activo de dinero/datos, el despacho `release_production=true` puede ir acompañado de `sev1_reuse_ci=true`: las suites se reusan solo si `sev1-verify` prueba que el commit exacto despachado (punta de `main`) ya pasó `build-test` y `rules-and-e2e` en su push; falla cerrado en cualquier duda. El release guard de versión+notas, el despliegue de reglas con paridad y la verificación post-release NO se omiten. La vía normal queda intacta.

## Regla de Firebase

- Los únicos IDs de proyecto Firebase permitidos en el repositorio son `store-os-dev` y `store-os-f7cf8`; cualquier otro destino bloquea el cambio.
- Todo desarrollo conectado, prueba contra emuladores y Preview usa el ID `store-os-dev`.
- Los emuladores usan ese mismo ID y el bucket de dev, pero todos sus servicios apuntan a `127.0.0.1`; no se crea otro proyecto ni namespace para el trabajo local.
- `.firebaserc` deja `store-os-dev` como proyecto predeterminado. Todo comando Firebase que permita elegir proyecto debe indicar el destino explícitamente; los comandos de desarrollo apuntan a `store-os-dev`.
- Producción (`store-os-f7cf8`) solo recibe releases vía CI (persona o agente bajo la autorización permanente del PO, 2026-11-08). El trabajo de desarrollo nunca ejecuta operaciones de datos contra producción.

## Regla permanente de arquitectura administrativa

- Toda operación administrativa requiere Firebase Auth y Firestore. No agregar ni restaurar persistencia administrativa alternativa en `localStorage`, acceso sin sesión ni datos de tienda operativos en el navegador.
- Si Firebase no está configurado o falla, mostrar un error explícito y no aparentar éxito ni cambiar a otro almacenamiento.
- Se conservan el carrito público, preferencias de tienda y tema, borradores de pedido asociados al UID y la infraestructura PWA. El storefront público sigue siendo anónimo y lee las proyecciones públicas Firebase.
- El panel administrativo requiere una sesión de Firebase Auth y guarda sus datos en Firestore. Si Auth o Firebase fallan, se muestra un error; nunca se abre un almacén local.
- La Fase B de erradicación de persistencia administrativa local se implementa en `chore/eradicate-local-mode`; su spec y criterios viven en `docs/superpowers/specs/2026-10-30-eradicate-local-mode-design.md`.

## Arquitectura (lo esencial)

- **Auth + roles:** `src/app/firebase/`. Email/password + Google; `super_admin` solo por el correo de plataforma (`admin@store.os`); los demás `member`. Las rutas administrativas requieren sesión; las rutas públicas del catálogo no.
- **Cloud:** Firestore en colecciones raíz (`users`, `stores`, `products`, `customers`, `orders`) + membresía (`memberUids`, `ownerUid`, `pendingInvites`). Reglas en `firestore.rules` (super-admin + miembros por tienda). El adaptador `firestoreData.ts` acota lecturas a las tiendas accesibles.
- **Estado:** `StoreProvider` mantiene el estado administrativo en memoria y lo sincroniza con Firestore. `localStorage` conserva únicamente preferencias, carrito público y borradores asociados a una persona autenticada.
- **Selector de tienda:** "¿Quién opera hoy?" (`StorePickerScreen`) tras iniciar sesión; "Cambiar tienda" regresa a él. Gestión completa (renombrar / cambiar tipo / WhatsApp / miembros / eliminar) en `StoreSettingsScreen`.
- **Sistema de diseño:** todo en `src/design-system/`, importado desde el barrel `index.ts`. Gate de cumplimiento: falla si `src/features/**` o `src/app/**` usan `<button>`/`<select>`/`<input>` crudos (excepción: `ErrorBoundary`).
- **Temas:** `src/design-system/theme/`. Cada tema define tokens (color, tipografía, radios, sombras, **movimiento**). `ThemeProvider` los inyecta en `<html data-theme>`. Per-usuario, persiste en `localStorage` → perfil Firestore.
- **Routing:** router de historia mínimo (`src/lib/router.ts` + `src/app/router.ts`), sin dependencias. La ruta pública `/catalogo/:slug` consulta las proyecciones `publicStores`/`publicProducts` con lectura anónima; las rutas administrativas requieren sesión.
- **Datos:** tipos en `src/types/index.ts`. Coerción numérica siempre vía `parseAmount` (`src/lib/money.ts`) — nunca escribas `NaN` al estado.

## Principio permanente de UX: menos trabajo para quien opera

**StoreOS existe para quitar trabajo operativo, no para trasladar a una pantalla los mismos pasos manuales.** Facilidad de uso, seguridad, integridad de dinero/inventario y pruebas son estándares de producto igualmente obligatorios en todas las tiendas. Diseña primero el recorrido de la persona operadora y después el código.

- **Menor fricción verificable:** minimiza clics/taps, desplazamientos, cambios de foco, navegación de ida y vuelta, recapturas y decisiones repetitivas. Busca menor esfuerzo total, no menos clics a costa de errores.
- **Captura una sola vez:** reutiliza datos conocidos, conserva contexto, recuerda asociaciones confirmadas, permite acciones en lote y propone valores razonables, sin inventar importes, existencias ni reglas. Toda propuesta sensible es revisable.
- **Flujos claros:** acción principal visible, lenguaje cotidiano, estados y errores comprensibles, teclado en escritorio y controles cómodos en móvil. Evita scroll horizontal, formularios extensos y confirmaciones redundantes.
- **Sin atajos peligrosos:** no sacrifiques accesibilidad, precisión, reversibilidad, auditabilidad ni permisos por ahorrar pasos. Dinero, inventario, cierres y privacidad conservan sus autorizaciones y confirmaciones explícitas.
- **Diseño antes de implementar:** define persona, tarea, frecuencia, caso habitual y excepciones; describe recorrido actual/propuesto y compara cuando sea posible taps/clics, scrolls, cambios de foco, recapturas y errores. No inventes métricas. Prefiere mejoras comprobables a rediseños especulativos.
- **Validación de uso:** una feature no está lista solo por compilar o pasar tests. Ejecuta el flujo real en dev/emuladores con datos sintéticos, móvil y escritorio cuando aplique.

### Principio transversal de composición visual: densidad útil, sin saturación (PO, 2026-11-10)

**Aprovecha el espacio disponible sin saturarlo ni desperdiciarlo.** Mostrar información y acciones pertinentes en la menor superficie *razonable* que permita comprenderlas, escanearlas y operarlas cómodamente. **Compacto no significa pequeño; limpio no significa vacío.** Es el estándar para **toda StoreOS**, administración y catálogo público, tiendas actuales y futuras, tanto en funcionalidades nuevas como en rediseños.

- **Filas y columnas para datos relacionados:** alinear importes, cantidades, estados y acciones a ejes visuales consistentes; la etiqueta va cerca del dato, sin separaciones arbitrarias. Preferir dos filas dentro de un mismo resumen antes que dos tarjetas, bloques o encabezados repetidos. Ejemplo #305: subtotal estimado a la izquierda + monto a la derecha; «¿Eres Iconic? Subtotal estimado» debajo + monto alineado, solo cuando el umbral lo permite.
- **Sin contenedores por inercia:** no añadir cards, recuadros, avisos, etiquetas o separadores que consuman altura sin mejorar jerarquía, reconocimiento o comprensión. Un aviso común puede servir a varias cifras; no repetir la misma aclaración en cada línea.
- **Cada fila aprovecha el ancho:** miniatura, identificación/variante, cantidad, estado y controles frecuentes alineados y agrupados cuando caben. Evitar fotografías colgadas debajo de los nombres, controles dispersos y formularios que crecen verticalmente sin motivo (ej. #310).
- **Mostrar lo necesario, no esconderlo tras más clics:** la información útil para tomar una decisión debe estar a la vista si cabe sin ruido; los detalles excepcionales pueden revelarse progresivamente. Ocultar por condición lo que deja de aplicar, sin reservarle una tarjeta vacía.
- **Responsive por recomposición:** usar anchos flexibles y prioridad de contenido. En móvil, si realmente no caben varias columnas, reorganizar de forma legible; jamás resolver la densidad con tipografía diminuta, objetivos táctiles reducidos, texto cortado, solapamientos o scroll horizontal. En escritorio, no desperdiciar ancho disponible ni estirar artificialmente cada campo.
- **Equilibrio evaluado, no píxeles arbitrarios:** comparar tarea real, información visible por pantalla, scroll necesario, facilidad de escaneo, alineación, lectura, errores y accesibilidad en ~390px y ~1280px, con pocos/muchos registros, nombres largos, variantes y estados excepcionales. No imponer cifras mágicas de padding, altura o número máximo de tarjetas.

**Gate de revisión UX independiente:** para toda feature visual nueva o rediseño, además del recorrido completo, el revisor debe responder «¿qué espacio desperdicia esta UI?», «¿qué bloques o mensajes son redundantes?», «¿qué datos se podrían alinear en una fila?», «¿la compacidad sigue siendo legible, accesible y segura?». La fricción o el scroll evitables y significativos del recorrido principal son hallazgos de UX; no exigir rediseñar superficies fuera del alcance sin evidencia.

### Estándar de entrega UX (mandato del PO, 2026-11-09 — obligatorio en todo StoreOS)

Nació del incidente 1.11.0 (Estrategia de precios/Reglas: técnicamente correcto, pruebas en verde, pero cientos de registros sin filtros ni selección masiva, descubierto al usarlo en vivo). Toda funcionalidad que entregue listas, configuración o trabajo sobre registros cumple esto **antes** de declararse lista:

1. **Diseñar tareas, no pantallas:** identifica quién usa la función, qué intenta lograr y el recorrido completo más natural. Componentes correctos por separado no bastan.
2. **Sin operaciones manuales repetitivas:** si la persona debe repetir la misma acción sobre muchos registros, evalúa acciones en lote, sugerencias, valores predeterminados y automatización segura. No se exige selección individual donde una selección contextual revisable resuelve.
3. **Navegación eficiente de colecciones:** conjuntos significativos de registros exigen búsqueda, filtros relevantes, ordenamiento, estados, selección múltiple o visualización progresiva. Volcar una colección entera en una lista interminable no es una interfaz terminada.
4. **Contexto conservado:** el paso siguiente conserva de dónde viene la persona (categoría, filtro, clienta); nunca la obligues a re-buscar lo que el sistema ya sabe.
5. **Acciones orientadas a resultados:** cada acción corresponde a una intención comprensible. Los estados vacíos dicen qué falta y ofrecen la acción apropiada; prevenir la confusión vale más que un error técnicamente correcto.
6. **Escalar con el negocio:** prueba con datos representativos — tienda nueva, pocos productos, cientos de registros. El e2e no se limita al escenario conveniente de 1–2 objetos.
7. **La tarea frecuente manda:** el uso habitual es fácil de descubrir y ejecutar; lo avanzado, excepcional y técnico no domina el recorrido principal.
8. **Seguridad antes que velocidad:** minimizar interacciones nunca justifica aplicar precios, mover inventario, cobrar o cambiar datos sensibles sin autorización. Se quita trabajo mecánico, no decisiones humanas.

### Doble revisión independiente obligatoria por item implementado

Cuando el autor considere terminada una issue y antes de integrarla o marcarla Hecho, **lanza dos subagentes distintos, de solo lectura y sin contexto previo del autor ni entre sí**, idealmente en paralelo. Cada uno recibe solamente la issue y sus decisiones/criterios actuales, el diff/PR, las guías del repositorio y el contexto de código/Preview estrictamente necesario. No hereda conversaciones, defensas del diseño ni conclusiones del otro revisor.

1. **Code reviewer:** busca bugs, regresiones, inconsistencias de negocio, precisión monetaria, aislamiento por tienda, Auth/reglas, seguridad, concurrencia, idempotencia, persistencia y pruebas insuficientes. Entrega hallazgos reproducibles con severidad, ubicación y escenario; CI verde no sustituye su aprobación.
2. **UX reviewer — misión de operadora:** actúa como una dueña o colaboradora real, no como revisor visual. Recibe (de los criterios de la issue o del coordinador, nunca del implementador) un **objetivo concreto de negocio** — p. ej. «Fer necesita aplicar una estrategia de precios solo a la categoría Reloj, con 283 SKUs en catálogo» — y **ejecuta el recorrido de principio a fin sin instrucciones del autor**, en build/Preview local con datos sintéticos (~390px móvil y ~1280px escritorio, toque/teclado según aplique). Su informe responde, como mínimo: ¿completó el objetivo sin que le explicaran cómo?; ¿cuántas interacciones relevantes necesitó?; ¿qué trabajo repetitivo evitó el sistema?; ¿qué pasa con un volumen representativo de registros?; ¿qué información, navegación o acciones faltaron?; ¿es igual de comprensible en móvil y escritorio?; ¿hay errores, estados vacíos o pasos siguientes confusos?; ¿qué impedimentos son bloqueantes y cuáles mejoras menores? Sin métricas inventadas ni presupuestos arbitrarios de clics: evidencia del recorrido ejecutado y evaluación justificada de su fricción.

Cada uno publica su veredicto independiente: **APROBADO, BLOQUEADO o NO APLICA justificado**. Si el UX reviewer encuentra que una tarea frecuente exige esfuerzo manual claramente evitable, emite **BLOQUEADO** explicando la alternativa. El UX reviewer también se convoca en trabajos sin interfaz: evalúa impacto indirecto sobre la operación o explica NO APLICA. Si el flujo afectado no pudo probarse, registra validación pendiente/BLOQUEADO, jamás afirma que lo probó.

**Los hallazgos críticos o mayores de código, y la fricción evitable significativa en el flujo principal afectado, bloquean merge y cierre** hasta corregir y repetir la revisión pertinente. Hallazgos menores fuera del alcance se documentan sin rediseños no autorizados. El implementador corrige; los revisores no modifican código. Registrar evidencia y veredictos en PR/issue. Estas revisiones se suman a CI, release guard y compuertas explícitas de Fer, no las sustituyen.

**Evidencia de UX en cada PR:** además de los checks, el PR documenta brevemente su validación UX — objetivo de negocio ejecutado, recorrido (pasos/pantallas), volumen de datos probado y veredicto del UX reviewer con su evidencia. Un CI verde no reemplaza esa evaluación.

## Convenciones (importantes)

- **🔴 CERO COSTOS — restricción dura.** El proyecto está en el plan Blaze **solo** porque Cloud Storage lo exige; **no se usa NADA que genere cobro**. Quédate siempre dentro del free tier. Límites no-cost que nos gobiernan:
  - **Firestore:** 1 GiB almacenado, 50K lecturas/día, 20K escrituras/día, 20K borrados/día, 10 GiB egress/mes.
  - **Storage:** 5 GB almacenados, 100 GB descargados/mes, 5K uploads/mes, 50K downloads/mes — **solo válido en regiones `us-central1`/`us-west1`/`us-east1`** (el bucket ya está en `us-east1`; no lo muevas).
  - **Auth:** email/password y Google son gratis. **Nunca auth telefónica** (cobra por SMS).
  - **Hosting:** 10 GB almacenado, 360 MB egress/día.
  - **Cloud Functions:** 2M invocaciones/mes gratis, pero evita Functions a menos que sea estrictamente necesario (cada una es una superficie de costo/latencia).
  - Prohibido: SQL Connect (trial de pago), App Hosting, cualquier servicio de Google Cloud que no sea Firestore/Storage/Functions- dentro-de-cuota.
  - Al diseñar una feature, estima su consumo (ej. `firestore.get()` en reglas = 2 reads por upload) y confirma que cabe en el free tier antes de implementar. Ante la duda, pregunta.
- **UI en español (México); código, tipos, identificadores y comentarios en inglés.**
- **Lenguaje simple, no empresarial.** Evita CRM, SKU, pipeline, fulfillment, gross margin, etc.
- **Mobile-first.** Tap targets ≥ ~40px, inputs a ≥16px (sin zoom en iOS).
- **Comportamiento sin sorpresas:** las decisiones visuales van por tokens del sistema de diseño, no por clases hardcodeadas. Si un color no se adapta al tema, lo estás haciendo mal — usa tokens (`bg-surface`, `text-on-surface`, `text-danger`, etc.).
- **Layout del panel:** un solo ancho — `Screen` sin `max-w`, las vistas fluyen a ancho completo; los formularios se auto-limitan (`max-w-5xl`); el ritmo y las columnas estándar viven en [`docs/DESIGN.md`](docs/DESIGN.md) (referencia: la vista Pedidos). El gate del design system prohíbe los anchos legacy (`max-w-3xl`/`max-w-6xl`) en features.
- **YAGNI / ponytail:** la solución más simple que funcione. Marca atajos deliberados con un comentario `ponytail:`. No agregues abstracciones no solicitadas.
- **Comprobación mínima:** toda lógica no trivial deja un test pequeño atrás (las trivialidades no necesitan test).
- **Garantías de seguridad G-P01–G-P08 (Espec 1):** aislamiento entre tiendas, `super_admin` sin PII de clientas por rol (plano de control `adminStores` separado del plano de datos), proyecciones públicas con allow-list, sin telemetría en el cliente. Ver `docs/superpowers/specs/2026-08-06-security-compliance-harness-design.md`. Las compuertas estáticas corren en `npm run test`; las de reglas en `npm run test:rules`; el egress runtime en `npm run e2e`. Ninguna es renunciable.

## Git / commits (preferencia del usuario)

- **Commits atómicos y regulares**, no un commit gigante. Un commit = un cambio lógico.
- Trabaja en una **branch** (no directamente en `main`) y abre PR.
- Mensajes tipo Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- Haz commit/push solo cuando se te pida (o al cerrar un paso lógico).
- Sin trailer `Co-Authored-By` en los commits (decisión del PO, 2026-11-09: no mezclar atribuciones de agentes con correos ajenos). (Esta convención se mantiene idéntica en `AGENTS.md` y `CLAUDE.md` — ambos archivos deben estar a la par.)

## Aplicación del feedback y continuidad

- Antes de preguntar o implementar, revisa el contexto accesible del proyecto: instrucciones, specs, backlog, issues, PRs y decisiones previas. Trata las correcciones y preferencias explícitas del usuario como criterios persistentes para cambios relacionados; no vuelvas a pedir confirmación de algo ya resuelto.
- Antes de abrir trabajo, revisa la rama y los PRs existentes. Continúa o corrige el trabajo relacionado que ya existe y evita duplicar una implementación.
- Cuando el usuario autorice continuar, completa el trabajo hasta dejar un resultado revisable. No pauses por permisos ya concedidos; aísla únicamente la parte que dependa de una decisión de negocio sin resolver sobre dinero, existencias, acceso, privacidad o producción, y avanza el resto.
- Valida el recorrido de la persona operadora en dev/emuladores cuando corresponda y comunica la evidencia concreta. CI en verde acredita checks técnicos, no por sí solo la aceptación funcional.
- Mantén los avances y el cierre concisos: qué cambió, qué se verificó y qué decisión real sigue pendiente.

## Delegación continua: la ambigüedad de alcance se resuelve hacia más autonomía

Regla dura nacida de un incidente real (2026-11-05): una delegación explícita de "continúa con todo lo que puedas hasta agotar el backlog o recibir otra instrucción" se tradujo en "entrego borradores y espero", con ~8 horas de avance perdidas por una interpretación arbitraria de "alcance acotado". No se repite.

- Una delegación de continuidad ("sigue con lo que puedas", "continúa con otras tres", "hasta que termines o te dé otra instrucción") es una **orden vigente, no una invitación**: se monta un ciclo de trabajo (tareas/loop, frente tras frente) y se agotan **todos** los frentes ejecutables. Las únicas paradas válidas son las condiciones de paro que el PO definió y las reglas duras de este archivo.
- La ambigüedad sobre el alcance de una autorización se resuelve **siempre hacia más autonomía**. Si la única razón para detenerse es la propia interpretación del alcance, esa interpretación es el defecto: se documenta la lectura adoptada y se continúa. Se pide confirmación únicamente cuando falta una decisión de negocio/dinero/datos que nadie ha tomado.
- Un frente bloqueado **no detiene la tanda**: se avanza con todo lo demás y el bloqueo se reporta con precisión (qué falta, quién lo resuelve). Nunca es justificación de inactividad ni de un informe final temprano.
- La revisión independiente del trabajo propio es **parte del avance**, no un alto: subagentes read-only rápidos + CI, y merge/liberación si la delegación vigente los cubre. No se espera a un humano que dijo que no estaría disponible.
- Límites que NO cambian: no inventar reglas de negocio/dinero; respetar compuertas explícitas registradas por el PO en issues (p. ej. validación de Fer antes de publicar cambios visuales); no operar datos productivos ni sembrar producción; cero costos.

### Estándar de UX (Definition of Done, PO 2026-11-09)

Válido para TODA funcionalidad de StoreOS, no solo precios. Una entrega técnicamente correcta con CI verde NO está lista si la experiencia falla; el incidente de 1.11.0 (cientos de registros sin filtro ni lote, pasos desvinculados) es el contraejemplo que originó esta compuerta.

1. **Diseñar tareas, no pantallas.** Antes de implementar: quién usa esto, qué quiere lograr y el recorrido completo más natural. Los componentes no valen aislados.
2. **Sin operaciones manuales repetitivas.** Si la persona debe repetir la misma acción sobre muchos registros: lote, valores por defecto, selección contextual revisable. Nunca selección individual cuando basta una contextual.
3. **Navegación eficiente de colecciones.** Con volúmenes reales: búsqueda, filtros relevantes, orden (priorizando lo pendiente), estados distinguibles, selección múltiple. Una lista interminable sin filtro no es una interfaz terminada.
4. **Preservar el contexto entre pasos.** Si viene de configurar una categoría, el paso siguiente ya está en esa categoría; nadie rebusca lo mismo dos veces.
5. **Acciones orientadas a resultados.** Estados vacíos que dicen qué falta y ofrecen la acción siguiente; errores que previenen la confusión, no solo técnicamente correctos.
6. **Escalar con el negocio.** Probar con datos representativos (tienda nueva, pocos productos, cientos de registros). Los E2E no se limitan al fixture conveniente de 2 objetos.
7. **Priorizar la tarea frecuente.** Lo habitual, visible y fácil; lo avanzado y las excepciones, fuera del recorrido principal.
8. **Seguridad antes que velocidad.** Menos trabajo mecánico JAMÁS significa aplicar precios, mover inventario, cobrar o cambiar datos sensibles sin autorización humana explícita. Se quita fricción mecánica, no decisiones.

**Compuerta de revisión UX (independiente, por issue):** además del revisor de diseño existente, un subagente independiente actúa como persona operadora REAL: recibe solo un objetivo de negocio y ejecuta el recorrido de principio a fin en la app (emulador), sin instrucciones de quien implementó. Su informe debe responder: ¿completó el objetivo sin ayuda?, ¿cuántas interacciones relevantes necesitó?, ¿qué trabajo repetitivo evitó el sistema?, ¿cómo se comportó con volumen representativo?, ¿qué navegación/acciones faltaron?, ¿es igual de claro en móvil y escritorio?, ¿estados vacíos/errores confusos?, ¿bloqueantes vs mejoras? Si una tarea frecuente exige esfuerzo manual claramente evitable, emite **BLOQUEADO** con la alternativa. Sin métricas inventadas: evidencia del recorrido ejecutado y fricción justificada. El CI verde NO sustituye esta evaluación.

**Evidencia por PR:** cada PR de funcionalidad documenta en su cuerpo el objetivo de negocio del recorrido validado, cómo se ejecutó (escenario + volumen) y el veredicto del revisor UX (o por qué no aplica).

## Out of scope (todavía)

Sin pagos/checkout/carrito, sin facturas, sin códigos de barras (la Clave/SKU de producto ya existe; proveedores y compras ya están implementados), sin ledger de inventario, sin analítica. El catálogo público cloud **ya está implementado** (`publicStores`/`publicProducts` en `firestore.rules`, lectura anónima; la proyección se mantiene al crear/editar tienda y productos, y con el botón "Republicar catálogo"). La subida de imágenes funciona pero requiere el grant IAM `roles/datastore.user` al Storage service agent (ver `docs/DEPLOYMENT.md` §4b) o las fotos fallan con 403.

## Estado del roadmap

1. ✅ Firebase Auth + Firestore + modelo de roles (super-admin + miembros por tienda).
2. ✅ Selector de tienda "¿Quién opera hoy?" + gestión completa de tiendas (crear/editar/cambiar tipo/invitar miembros/eliminar).
3. ✅ UI por rol (dueño vs. super-admin) + aislamiento de datos + listo para Vercel.

## Despliegue

Guía completa en `docs/DEPLOYMENT.md` (Firebase + Vercel + variables de entorno + reglas). `super_admin` solo por el correo de plataforma (`admin@store.os`).

### Ambientes y backends (cableado)

Desarrollo y Preview usan `store-os-dev`. Producción usa `store-os-f7cf8` y solo recibe releases vía CI (persona o agente con la autorización permanente del PO, 2026-11-08). El proyecto predeterminado de Firebase es dev. Los emuladores locales usan el mismo ID de dev y servicios en `127.0.0.1`.

| Ambiente | Backend Firebase | Cómo se cablea |
|---|---|---|
| Local (desarrollo conectado) | `store-os-dev` | `.env` local con las vars de dev (`VITE_FIREBASE_*`). Aquí validan los agentes ANTES de pushear. |
| Preview (Vercel, UAT/QA) | `store-os-dev` | GitHub environment `Preview` → 6 `VITE_FIREBASE_*` secrets de dev. |
| Producción (Vercel) | `store-os-f7cf8` | GitHub environment `Production` → 6 secrets de prod. Aislado: ventas reales. |

`scripts/check-env.cjs` hace cumplir el contrato: desarrollo local y Preview deben apuntar exactamente a `store-os-dev`; Production debe apuntar exactamente a `store-os-f7cf8`. Los datos de prueba viven en `store-os-dev` y se siembran con `node scripts/seed-dev.cjs` (Olivia + admin@store.os); **nunca** se siembra ni toca prod.

Los diseños detallados viven en `docs/superpowers/specs/`.
