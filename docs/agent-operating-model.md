# Modelo operativo multiagente — Store OS

**Acuerdo del Product Owner (2026-11-18).** Aplica a trabajo nuevo y a la continuidad de issues existentes. El objetivo es conservar la intención de negocio de principio a fin, delegar con autonomía y separar implementación de verificación.

Esta política **complementa** \`AGENTS.md\`, \`CLAUDE.md\`, \`LOOPS.md\` y el README vigente del tablero [Store OS](https://github.com/users/imalvaroglez/projects/1). **No reemplaza** las reglas del tablero sobre estados, responsables y evidencias; ni modifica permisos de merge/producción, gates de CI, revisión independiente, decisiones explícitas del PO/Fer o restricciones de Firebase, privacidad y cero costos. Ante discrepancias operativas prevalecen las fuentes vigentes indicadas en esos documentos. La **issue es la fuente de verdad de sus requisitos aprobados**; las conversaciones de agentes no lo son.

## Roles y límites de responsabilidad

| Rol | Asignación habitual | Responsabilidad principal | No debe |
| --- | --- | --- | --- |
| **Product Owner (PO)** | Persona responsable de Store OS; Fer interviene donde exista una compuerta explícita de negocio | Define intención, prioridades, reglas sensibles y aceptación de decisiones no resueltas | Delegar sin registrar una nueva regla crítica ni tratar una hipótesis como hecho |
| **Tech Lead / Product Architect** | **Codex** | Descubre necesidades reales, revisa contexto previo, cuestiona supuestos, diseña el recorrido, arquitectura, criterios y contrato de la issue | Inventar precios, dinero, existencias, permisos o decisiones comerciales; dar por aceptado código solo porque coincide con su propuesta |
| **Implementador** | **ZCode**, sesión de desarrollo | Toma una issue \`Listo\`, implementa con TDD, prepara commits, pruebas técnicas y draft PR | Reinterpretar unilateralmente las reglas aprobadas ni declararse su propio QA independiente |
| **QA / Testing** | **ZCode**, **sesión independiente** de la que implementó | Verifica la entrega contra la issue desde el punto de vista de la operadora; ejecuta casos positivos, negativos, regresiones, UX y pruebas necesarias en dev/emuladores | Heredar la defensa del autor, aprobar sin evidencia ni alterar el código de la feature en la sesión de verificación |
| **Release Manager** | **ZCode**, sesión o ejecución independiente de entrega | Comprueba gates, prepara/promueve la liberación autorizada mediante CI, verifica producción y registra versión/evidencia | Saltar las revisiones, hacer push directo a \`main\`, desplegar manualmente o manipular datos productivos |
| **Sistema de despliegue** | GitHub Actions | Ejecuta las validaciones y el deploy bajo los workflows existentes | Ser sustituido por comandos manuales de un agente |

Los nombres de herramientas son la **asignación preferida**, no una garantía de capacidad, una identidad personal ni una exclusividad técnica. Si otro agente asume un rol, debe recibir el contrato y respetar exactamente la misma separación, permisos y compuertas. **Para una misma entrega no se fusionan la sesión de implementación y la sesión de QA.** TDD del autor es obligatorio cuando aplica, pero **no reemplaza** el Testing independiente. Tampoco reemplaza los **dos revisores read-only, sin contexto mutuo (Code y UX)** ya exigidos por \`AGENTS.md\`/\`LOOPS.md\`.

## Contrato de entrega en la issue

El Tech Lead debe escribir o refinar la issue hasta que una sesión nueva de desarrollo **y otra de QA**, sin haber participado en el descubrimiento, puedan trabajar correctamente sin reconstruir la conversación original.

La profundidad es **proporcional al riesgo y tamaño**: no convertir un ajuste trivial en una ceremonia. Para cambios relevantes, el cuerpo de la issue debe dejar explícitos:

1. **Intención de negocio:** quién opera, qué intenta lograr, por qué importa y cuál es el resultado observable.
2. **Estado actual y recorrido objetivo:** pasos antes/después, acción principal, información requerida, excepciones y continuidad del contexto. Considerar operación habitual y volumen realista.
3. **Reglas del dominio y datos:** definiciones, fórmulas, estados, permisos, origen de verdad, validaciones, efectos secundarios y casos límite. Señalar explícitamente lo que falta decidir; no inventar valores.
4. **Contrato de interfaz si aplica:** distribución y jerarquía concretas (filas/columnas, etiquetas, importes, acciones), estados vacío/carga/error, móvil/escritorio, accesibilidad y ejemplos suficientes para reproducir la intención visual. No dejar la experiencia a interpretaciones genéricas de "hacerlo intuitivo" o "más compacto".
5. **Criterios de aceptación verificables:** escenarios normales, negativos, regresiones y datos representativos. Separar resultado esperado de sugerencias de implementación; precisar evidencia esperada en QA.
6. **Restricciones y alcance:** dependencias, no objetivos, seguridad, aislamiento multitienda, dinero/inventario, Firestore, costos, migración y consecuencias sobre datos existentes cuando corresponda.
7. **Puertas de decisión:** qué ya resolvió el PO, qué sigue pendiente, si Fer debe validar algo, y qué condición bloquea desarrollo, merge o publicación.

Si la issue es pequeña, basta el conjunto mínimo de objetivo, regla/resultado esperado y casos de aceptación inequívocos. La **spec de archivo** continúa siendo excepcional para arquitectura o reglas de negocio y debe viajar en el mismo PR del código cuando aplique; no se crea un PR documental por cada feedback. Los estados y el significado de \`Listo\`, \`En PR\`, \`Por liberar\` y \`Hecho\` son los del tablero/LOOPS vigentes.

## Transferencias y ejecución

### 1. Descubrimiento y diseño — Tech Lead

- Revisa guías, issues/PRs relacionados, código, incidentes y decisiones previas antes de proponer duplicados.
- Traduce el lenguaje de negocio a un contrato verificable; contrapone recorrido actual y propuesto, propone alternativas con sus riesgos y registra la decisión válida en la issue.
- Si hay ambigüedad material sobre importes, existencias, reparto, acceso, privacidad o cambios irreversibles, no inventa la regla: señala exactamente la decisión necesaria. Lo no bloqueado sigue avanzando.
- No manda a implementar como \`Listo\` un requisito que aún depende de una compuerta explícita del PO.

### 2. Implementación con TDD — Developer

- Toma únicamente trabajo elegible según el tablero; registra asignación y worktree.
- Respeta una issue/cambio por rama desde \`main\` y draft PR; mantiene commits atómicos. Primero observa fallar los tests que correspondan, luego implementa y los deja verdes.
- Sigue el contrato visual y funcional aprobado, además del sistema de diseño, sin sustituirlo por una interfaz "parecida". Los cambios de alcance o contradicciones vuelven a la issue/Tech Lead con evidencia, no se deciden a escondidas.
- Ejecuta y documenta validaciones técnicas aplicables; no representa pruebas pendientes como realizadas. El implementador corrige hallazgos, pero no emite su propio veredicto de QA.

### 3. Testing independiente — QA

- Comienza en **otra sesión** y recibe **solo** issue/criterios vigentes, diff/PR, guías y entorno técnico necesario; no las explicaciones o conclusiones de la sesión que implementó.
- Prueba el resultado como persona operadora con datos sintéticos en dev/emuladores: objetivo de extremo a extremo, casos negativos, regresiones y volumen representativo; móvil/escritorio si aplica.
- Publica escenarios efectivamente ejecutados, resultado esperado/observado, evidencias, defectos reproducibles con severidad y veredicto **APROBADO**, **BLOQUEADO** o **NO APLICA justificado**. Lo no verificable se marca pendiente, no aprobado.
- Se preservan **además** la revisión independiente de código y la de UX descritas en los documentos vigentes. QA puede organizar evidencias, pero no convertir revisores en defensores del implementador.
- Hallazgos bloqueantes regresan a Development; corregidos, se repite la comprobación afectada en sesión independiente antes del merge.

### 4. Integración y liberación — Release Manager

- Comprueba que la issue/PR contiene trazabilidad y evidencias requeridas, CI completo verde, revisiones independientes sin bloqueantes, y cualquier aprobación explícita pendiente.
- La integración autorizada mueve la historia de producto a **Por liberar**, no a **Hecho**. Conserva las excepciones Sev-1 y autorizaciones vigentes exactamente como están escritas en los runbooks, no crea nuevas excepciones.
- Coordina el release con los workflows actuales de **GitHub Actions** y el release guard (versión/notas), sin operaciones manuales sobre Firebase productivo.
- Verifica la ejecución y el commit/versión realmente publicados, registra evidencia de producción y actualiza el tablero conforme al README vigente. Solo después de publicar exitosamente pasa la historia de producto a **Hecho**. Cuando corresponda, prepara el mensaje conciso para Fer usando la plantilla existente.
- Un fallo o bloqueo de release no convierte una publicación en éxito ni detiene otros frentes independientes ejecutables.

## Comunicación y criterios de calidad

- **Handoff legible sin chat previo:** cada agente parte del estado documentado de la issue y deja un resumen corto con hechos, pruebas, enlaces y el único bloqueo real, si existe.
- **No autovalidación:** quien implementó no hace pasar sus propios tests TDD por el testing independiente; la revisión read-only de código/UX sigue vigente.
- **No confundir evidencia:** "tests verdes", "PR merged", "release despachado" y "confirmado en producción" son estados diferentes.
- **Economía de contexto:** usar el nivel de razonamiento/modelo adecuado al trabajo, sin comprometer los gates. Como preferencia operativa actual: Codex con un modelo Sol para descubrimiento y diseño; ZCode con GLM High para implementación y QA complejos, y menor esfuerzo para comprobaciones mecánicas de release. Son referencias modificables, **no versiones obligatorias** ni excusa para omitir validaciones.
- **Prioridad de producto:** reducir trabajo real de la operadora sin perder precisión, permisos, auditabilidad, confiabilidad ni calidad visual. Una feature técnicamente correcta con mala experiencia no está terminada.

**Regla de cierre:** una entrega solo está completa cuando su resultado de negocio está implementado, verificado con independencia, liberado conforme a los gates aplicables y respaldado por evidencia en la issue/PR.