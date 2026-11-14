# Análisis interno — ¿Puede atribuirse el consumo por tienda?

> #204 — Documento interno para el PO. **No se muestran costos a propietarias de tiendas y no se activa cobro alguno.** Complementa el reporte manual de #191 (`npm run usage-report`): aquí se pregunta qué parte, si alguna, puede desglosarse **por tienda**. El estado vigente del acuerdo no cambia: Olivia no paga suscripción ni cargos de plataforma.

## 1. Matriz de recursos — alcance y fuente

| Recurso | Métrica disponible | Unidad | Periodo | Alcance atribuible | Fuente verificable | Desfase |
|---|---|---|---|---|---|---|
| Firestore (dev y prod) | `billable_read_units` / `billable_write_units` — **vacío en la práctica** | unidades | 24 h / 30 d | **proyecto** (una base por proyecto) | Cloud Monitoring | horas; hoy viene sin series |
| Firestore | `request_count` por `api_method` | solicitudes | 24 h / 30 d | **proyecto** | Cloud Monitoring | minutos/horas |
| Firestore almacenado | **sin métrica pública** | — | — | **no disponible** | requiere exportación de facturación | — |
| Storage (dev y prod) | objetos y bytes por bucket | GB / archivos | ahora | **proyecto** (bucket por proyecto) | `gcloud storage du` | en vivo |
| Auth | usuarios por proyecto | cuentas | ahora | **proyecto** | Consola (sin métrica agregada pública) | — |
| Vercel | uso del equipo/proyecto | — | mes | **equipo** (los deployments preview/prod comparten plan) | **pendiente del PO**: solo si el acceso de lectura ya existe | — |
| GitHub Actions | minutos del repositorio | min | mes | **repositorio** | `gh api actions/usage` | en curso |
| Funciones | invocaciones | cuenta | mes | **proyecto** | Cloud Monitoring | minutos |

**Hecho clave (verificado con #191):** las unidades facturables de Firestore son **por proyecto/base de datos**, no por tienda. Una misma base atiende a todas las tiendas del proyecto; separar «cuánto leyó la tienda A vs la tienda B» exige instrumentación que hoy no existe y que costaría escrituras/lecturas nuevas.

## 2. Qué puede y qué no puede atribuirse

**Atribuible hoy (con evidencia):** consumo a nivel **proyecto/entorno** (dev vs producción) para Firestore, Storage y Actions, con el reporte manual #191. Diferencias groseras de Storage por bucket (si cada tienda tuviera bucket propio — **no es el caso**: hoy es un bucket por proyecto).

**No atribuible (sin prorrateo arbitrario):** el uso de Firestore por tienda. Las reglas de seguridad evalúan membresía por documento, pero cada consulta lee los documentos de UNA tienda — el volumen por tienda solo se conocería contando por `storeId`, lo cual exige una métrica por campo que Cloud Monitoring no expone.

**Ejemplo sintético (dos tiendas, sin datos reales):** la tienda A publica un catálogo de 300 piezas y la tienda B tiene 5. Un mes en que Fer navega mucho la tienda A genera ~90% de las lecturas del proyecto. Si se dividiera el consumo compartido «a la mitad», la tienda B pagaría (si cobrara) por navegación que no ocurrió. **Conclusión: el consumo compartido no se asigna arbitrariamente; sin métrica por tienda el dato es «no atribuible», no cero ni un prorrateo.**

## 3. Separación obligatoria de cifras

- **Consumo medido**: métrica de Monitoring/du (ej. solicitudes Firestore 24 h).
- **Factura real del proveedor**: $0 en Blaze dentro de free tier; lo verificable sin acceso a facturación es el consumo, no la factura — la factura queda como dato del PO.
- **Cuota gratis / crédito**: límites documentados (Firestore 50K lecturas/día, etc.).
- **Estimación**: cuando la métrica viene vacía (billable_* hoy) se marca como estimación/retrasada, nunca como consumo confirmado.
- **Importe cobrado**: $0 — sin cobros activos; no se cambia el acuerdo.

## 4. ¿Basta el reporte #191 para un desglose interno?

**Sí para nivel proyecto** — `npm run usage-report` ya reporta por entorno con método y muestra (MED/EST/AUS/SIN ACCESO), sin servicios nuevos ni costos. **No para desglose por tienda**: haría falta (a) una métrica por campo `storeId` (no existe en Monitoring), o (b) contar lecturas en el cliente (requiere escribir contadores por tienda — escrituras nuevas por cada operación; estimación: ~1 escritura por sesión activa si se agrega solo al cierre de sesión, o 1 por pedido/edición: del orden de 10²–10³ escrituras/día, dentro de la cuota, pero es instrumentación nueva y **no se recomienda sin decisión del PO**).

## 5. Decisiones futuras (lista corta)

1. **¿Estado visible por tienda?** Hoy no existe ni se recomienda crear sin demanda: el acuerdo vigente es sin cargos por tienda; un estado visible puede leerse como factura anticipada.
2. **¿Regla verificable para recursos compartidos?** Solo aplicaría si hubiera métrica por tienda; sin ella, la regla honesta es «no atribuible».
3. **¿Acuerdo de servicio pagado?** No existe; este análisis no lo propone.

## 6. Fase siguiente recomendada (pequeña, cero costos)

Mantener **#191 como la herramienta de medición interna** y registrar aquí los hallazgos por entorno (el reporte de 2026-11-14 ya mostró producción en 66% de la cuota diaria de lecturas). Solo si el PO decide medir por tienda: prototipo de contador por tienda cerrado por sesión (escrituras en orden de 10²/día), con su propia issue y compuerta — no una vista por tienda.

## Límites

Sin datos de clientas, sin contactar propietarias, sin cambios en Firebase/Vercel, sin proyección de cobros. La revisión del plan de Vercel queda pendiente del PO (acceso de lectura que hoy no se ha verificado); no se infiere infracción de términos.
