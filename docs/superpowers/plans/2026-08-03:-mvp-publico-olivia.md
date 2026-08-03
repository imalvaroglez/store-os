# Meta: MVP público de Olivia dentro de Store OS

## Resumen

Extender `/catalogo/olivia` hasta convertirlo en un sitio público, funcional y desplegable: marca, catálogo, categorías, detalle de producto y contacto por WhatsApp. Fer podrá administrar sin código el contenido operativo, productos, disponibilidad, categorías y fotografías.

La base actual ya aporta Firebase, aislamiento por tienda, administración, imágenes y proyección pública. Antes de construir:

- Integrar los 32 commits pendientes de `feat/product-image-upload` y crear `codex/olivia-storefront` desde esa base.
- Preservar los archivos no rastreados del usuario.
- Corregir el `StoreProvider` duplicado y los dos tests actualmente fallidos. El punto de partida debe quedar verde.

La meta termina cuando una clienta puede descubrir Olivia, explorar categorías, abrir una pieza y contactar por WhatsApp; y Fer puede completar las tareas habituales de publicación sin asistencia técnica.

## Interfaces y modelo de datos

- Agregar `Category` como entidad privada por tienda: `id`, `storeId`, `name`, `slug`, descripción, imagen, orden, estado activo y fechas. Su identificador incorporará `storeId + slug` para garantizar unicidad por tienda.
- Extender `Product` con:
  - `sku` y `slug` estable; colisiones reciben sufijos y el slug no cambia al renombrar.
  - Una categoría principal obligatoria y hasta dos secundarias.
  - Galería de 1–5 imágenes con URL, ruta de Storage, texto alternativo, dimensiones, orden y marca principal.
  - Material, color/acabado, medidas y cuidados.
  - Publicación: `draft | published | archived`.
  - Disponibilidad: `available | low_stock | sold_out`.
  - `isNew`, `isFeatured`, `canInquire` y `sortOrder`.
- Agregar a `Store` un `storefront` estructurado y editable: hero, beneficios, historia, reventa, FAQ, aviso, entregas, pagos, políticas, horarios, Instagram, textos de WhatsApp, visibilidad de agotados y SEO.
- Mantener costos, cantidades exactas, mayoreo, márgenes y notas privadas fuera de toda proyección pública.
- Crear una migración idempotente para productos existentes: convierte categoría, `imageUrl` e `isPublic` al modelo nuevo, genera categorías deterministas y marca la versión migrada sin duplicar datos.
- No agregar todavía una colección ejecutable de prospectos: por YAGNI, sólo se documentará el contrato futuro y sus requisitos de seguridad.

## Implementación

1. **Persistencia, proyecciones y seguridad**
   - Incorporar categorías al estado local, selectores, Firestore y sincronización.
   - Reemplazar la consulta pública completa por:
     - `publicStores/{slug}`: identidad, contenido y contacto.
     - `publicCatalogs/{slug}`: categorías y resúmenes ligeros de productos.
     - `publicProducts/{storeId}__{productSlug}`: detalle público individual.
   - Una visita al storefront usará dos lecturas; abrir un producto añadirá una.
   - Endurecer reglas para que miembros no puedan leer o modificar entidades de otras tiendas ni sobrescribir proyecciones públicas ajenas.
   - Reutilizar `ownerUid`: super-admin o dueño puede editar tienda/contenido; miembros conservan únicamente las capacidades actuales del catálogo. Añadir transferencia explícita de propiedad para asignar Olivia a Fer.
   - “Republicar catálogo” reconstruirá todas las proyecciones y eliminará documentos públicos obsoletos.

2. **Administración para Fer**
   - Ampliar Catálogo con vistas “Productos” y “Categorías”.
   - Permitir crear, ordenar, desactivar y editar categorías; impedir borrar categorías asociadas.
   - Validar al publicar: SKU, precio, categoría principal, máximo tres categorías y fotografía principal.
   - Crear un administrador móvil de galería: subir, previsualizar, ordenar con controles accesibles, elegir principal y eliminar.
   - Aceptar originales de hasta 10 MB; almacenar sólo JPEG optimizado, orientación corregida, máximo 1600 px y calidad 80 %. No conservar originales ni generar miniaturas separadas en este MVP.
   - Agregar “Sitio público” a las opciones de tienda para editar las secciones estructuradas, FAQ, contacto, imágenes de marca y reglas comerciales sin editor visual libre.
   - Mantener colores y tipografías en una configuración Olivia centralizada, no editable: fondo marfil, texto oscuro, acento rosa sobrio, Playfair Display y Plus Jakarta Sans.

3. **Storefront público**
   - `/catalogo/olivia`: encabezado, hero, categorías activas, destacados, catálogo, historia, reventa, FAQ, contacto y pie.
   - `/catalogo/olivia/categoria/:categorySlug`: descripción, imagen, productos publicados y estado vacío.
   - `/catalogo/olivia/producto/:productSlug`: galería, información completa pública, categorías, disponibilidad, regreso al catálogo y CTA.
   - Navegación principal mediante anclas; sólo categoría y producto reciben rutas nuevas.
   - Productos archivados o borradores nunca aparecen. Los agotados respetan la configuración de tienda y `canInquire`.
   - Mensajes de WhatsApp siempre agregan nombre, SKU, URL e intención. El texto editable será sólo la introducción, evitando que Fer elimine accidentalmente el contexto.
   - CTA independientes para producto, contacto general y reventa. Si WhatsApp falla, se muestra el número de contacto; iniciar conversación nunca promete una reserva.
   - Compartir usa Web Share API con copia de enlace como respaldo.

4. **SEO, rendimiento y despliegue**
   - Metadatos por ruta, canonical, Open Graph, Twitter Cards y JSON-LD para Olivia y productos.
   - Añadir una entrada HTML estática de Olivia y una rewrite anterior al fallback SPA, de modo que WhatsApp muestre al menos la tarjeta general de Olivia. Las tarjetas específicas por producto requerirían renderizado del lado servidor y quedan fuera.
   - Separar por carga diferida el storefront y el panel para que el público no descargue código administrativo.
   - Imágenes secundarias con carga diferida, HTML semántico, enlace para saltar contenido, foco visible, acordeones accesibles y objetivos táctiles de al menos 40 px.
   - Actualizar despliegue, configuración inicial de Olivia, migración, reglas, Storage, republicación, rollback y verificación de rutas profundas.
   - Documentar consumo: guardar un producto usa aproximadamente tres escrituras públicas/privadas; cada foto implica un upload y dos lecturas de reglas. Firestore ofrece 50 000 lecturas y 20 000 escrituras diarias sin costo, pero Blaze cobra excedentes; se configurarán alertas y el flujo público seguirá funcionando sin formularios persistentes. [Cuotas oficiales de Firestore](https://firebase.google.com/docs/firestore/pricing)
   - El formulario protegido queda para una fase posterior. App Check/reCAPTCHA ofrece una cuota gratuita limitada y puede generar costo al excederla, por lo que no bloqueará este lanzamiento. [App Check para web](https://firebase.google.com/docs/app-check/web/recaptcha-provider), [precios de reCAPTCHA](https://docs.cloud.google.com/recaptcha/docs/billing-information)

## Pruebas y aceptación

- Unitarias: migración, slugs, categorías por tienda, máximo de categorías/fotos, proyecciones sin datos privados, orden, estados y mensajes de WhatsApp.
- Reglas con emulador: aislamiento entre tiendas, permisos de dueño/miembro, categorías compatibles con `storeId`, escrituras públicas denegadas y acceso anónimo sólo a proyecciones.
- E2E Firebase móvil y escritorio:
  - Fer crea categoría, contenido y producto con 1–5 fotos.
  - Publica, destaca, agota, archiva y republica.
  - Clienta navega inicio → categoría → producto → WhatsApp.
  - CTA de reventa genera el mensaje correcto.
  - Rutas desconocidas muestran estados claros y ninguna vista filtra datos privados.
- Validar navegación por teclado, contraste, reducción de movimiento, ausencia de desplazamiento horizontal y enlaces profundos después de recargar.
- Antes de cerrar: `npm run typecheck`, `npm run test`, `npm run build`, `npm run e2e` y `npm run e2e:firebase`; después ejecutar la revisión `store-os-review`.
- Entregar en commits atómicos: estabilización, modelo/migración, administración, storefront y finalmente pruebas/documentación.

## Supuestos y exclusiones

- Olivia conserva el slug `olivia` y vive en `/catalogo/olivia`; no se agregan dominios personalizados.
- Se usarán textos e imágenes provisionales claramente identificados hasta recibir los definitivos.
- Sin carrito, pagos, cuentas de clientas, variantes, formularios persistentes, CRM, envíos automatizados, facturación, comisiones ni precios públicos de mayoreo.
- El catálogo público se entrega en una sola carga optimizada; paginación se añadirá sólo si el documento agregado se acerca al límite de Firestore o el volumen real lo justifica.
