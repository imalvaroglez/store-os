# Matriz de propiedad, control y decisiones — Store OS y Olivia

> #205 — Documento para revisar en **una sesión** con Fer y, cuando corresponda, asesoría legal/fiscal. Cada afirmación se clasifica **[verificada]** (existe en el código/reglas), **[propuesta]** (opción no decidida) o **[pendiente de validar]** (no concluye desde el código). Este documento no decide derechos, no crea contrato ni implementa cambios.

## A. Matriz de elementos

| Elemento | Quién lo controla hoy | Acceso/modificar/exportar | Dónde se guarda | Evidencia | No concluye desde el código |
|---|---|---|---|---|---|
| **Marca y contenido de Olivia** (nombre, logo, textos, fotos) | Fer los captura en la app | Dueña/miembros de la tienda vía editor autenticado | Firestore (`stores.storefront`, `products`) + Storage (`storefront/{storeId}`) | [verificada] reglas por membresía; carga solo por sesión | Titularidad de la marca y licencia de uso del **código** que la muestra |
| **Catálogo público** (proyecciones `publicStores/publicProducts`) | Fer publica/republica | Lectura anónima; escritura solo miembros | Firestore (colecciones públicas) | [verificada] reglas #374 (id ligado al contenido) | Responsabilidad por contenido publicado ante terceros |
| **Datos de clientas** (nombre, WhatsApp, pedidos, saldos) | Fer | Solo dueña/miembros de la tienda; aislamiento entre tiendas | Firestore (`customers`, `orders`) | [verificada] auditoría #176; sin lecturas de directorio | Encargo de tratamiento Fer↔Mari; base jurídica LFPDPPP (ver #311) |
| **Pedidos e inventario** | Fer | Miembros con sesión | Firestore (`orders`, `products`) | [verificada] reglas; reservas por `revision` | Propiedad de la información operativa ante un convenio comercial |
| **Cobros y finanzas** (cobros, crédito, cierres en propuesta) | Fer | Miembros; campos de crédito solo por operación firmada | Firestore | [verificada] #380 (en decisión); acumuladores por documento | Reparto de ganancia e inversión = relación financiera **separada** (#128) |
| **Código reutilizable** (features genéricas del panel) | Álvaro (Store OS) | Repositorio GitHub privado | Git | [verificada] historia del repo | Licencia de uso de Fer sobre el código: **[pendiente de validar]** |
| **Personalizaciones para Olivia** (vitrina editorial, precios por nivel) | Fer las usa; Álvaro las construyó | Edición autenticada | Firestore + código | [verificada] `OliviaStorefront`, tiers | Si la personalización "pertenece" al servicio o a la tienda |
| **Configuración e infraestructura** (Firebase, Vercel, CI) | Álvaro | Cuentas de plataforma del PO | Google/Vercel/GitHub | [verificada] regla de proyecto dev/prod | Acuerdo de servicio, SLA, disponibilidad |
| **Credenciales y llaves** | Álvaro | Solo el PO; ninguna en el repo | Secretos de CI/Consola | [verificada] reglas del repo; browser key acotada (#158) | Custodia y rotación ante salida |
| **Datos de consumo** (uso de cuotas) | Álvaro | Reporte manual local #191 | Cloud Monitoring | [verificada] #204: por proyecto, **no atribuible por tienda** | Sin cargos vigentes; no nace deuda por inferencia |

## B. Separación de decisiones

- **Operativas (Fer, Olivia)**: precios, niveles, catálogo, clientas, pedidos, inventario, fotografía, aviso de privacidad de SU negocio, condiciones de venta.
- **De plataforma (Álvaro, StoreOS)**: infraestructura, cuentas y facturación de proveedores, disponibilidad, seguridad técnica, roadmap del producto, super_admin y su allowlist. La autoridad **comercial** de Fer (precios, ventas, clientas) es distinta de los permisos técnicos de `super_admin` — un permiso no otorga el otro.
- **Acuerdo entre partes**: licencia/uso del código y personalizaciones, soporte y su alcance, prioridad de incidentes, exportación/salida de datos de la tienda, subproveedores, continuidad si alguna parte sale.
- **Revisión legal/fiscal**: redacción de contrato, carácter de la inversión del 20% (#128, relación financiera separada del servicio), impuestos/CFDI, protección de datos (#311), comprobantes.

## C. Qué existe y qué no existe

**Existe [verificada]**: aislamiento por tienda con sesión; exportación de respaldo cifrada (procedimiento del PO); catálogo público anónimo sin datos privados; auditoría de seguridad #176.
**No existe [verificada]**: exportación self-service por tienda; botón de "borrar mi tienda y llevármelo"; estados de cuenta por tienda; checkout/pagos. Nada de esto se promete aquí.

## D. Preguntas para Fer y el asesor (con efecto producto)

1. **Licencia de uso** del panel para Olivia (duración, alcance, terminación) → bloquea cualquier función "propiedad de la tienda" en la UI.
2. **Soporte e incidentes** (tiempos, canal, alcance; hoy informal) → bloquea cualquier compromiso visible de disponibilidad.
3. **Exportación/salida**: ¿formato y momento? → bloquea una función de exportación por tienda (hoy manual por el PO).
4. **Subproveedores** (Google Firebase, Vercel, GitHub): aceptación y notificación → bloquea cambios de proveedor o región.
5. **Continuidad**: ¿qué pasa con catálogo y datos de clientas si el servicio termina? → bloquea la automatización de salida/borrado.
6. **La inversión del 20%** es financiera y separada del servicio (hecho vigente); su documento propio es #128 — esta matriz no la toca.

## Límites

Sin datos productivos, sin conversaciones privadas no proporcionadas, sin contactar a Fer/Mari/abogados, sin escribir contratos ni cambiar configuración. **[pendiente de validar]** todo lo jurídico; este documento solo ordena hechos verificables y opciones.
