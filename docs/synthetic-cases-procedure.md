# Procedimiento: casos de prueba sintéticos a partir de respaldos

> #396 — Cómo convertir un patrón de un respaldo cifrado de producción en un caso reproducible contra los emuladores locales, reteniendo **solo relaciones y valores sintéticos**. Nada de este procedimiento sube respaldos ni extractos a Git, CI o servicios externos.

## Reglas duras

1. **Solo emuladores.** Todo caso corre contra `FIRESTORE_EMULATOR_HOST`/`FIREBASE_AUTH_EMULATOR_HOST` en `127.0.0.1`; el script aborta si falta o apunta a otra dirección. Nunca datos productivos.
2. **Vida privada por localización.** Los scripts viven en el área privada del PO (`/private/tmp/store-os-*-private/`), fuera del árbol de Git. Este documento describe el método; los casos NO viajan en el repositorio.
3. **Deny-list de privacidad (automática).** Cada script declara los marcadores reales del caso (nombre de tienda, personas, claves, teléfonos) y **falla** si algún valor sembrado los contiene. Excluir siempre: nombres, contactos, cuentas, notas, imágenes, credenciales y referencias privadas.
4. **Huella de equivalencia (automática).** El script verifica al final que la estructura sembrada coincide con el patrón del respaldo: colecciones tocadas, relaciones entre documentos (p. ej. líneas con `productId`+`variantId` apuntando a una ficha eliminada), estados y tipos de campo. Los importes usan valores redondos sintéticos.
5. **Relaciones, no personas.** Se conserva lo mínimo para reproducir el defecto: qué colecciones, qué enlaces entre documentos, qué estados. Todo identificador es inventado y trazable al caso (`syn-…`, fechas fijas).

## Recorrido (por caso)

1. **Extraer el patrón** del respaldo (descifrado local, ver `audit-fresco.py`): qué documentos participan y qué relación produce el defecto. Anotar la huella esperada antes de escribir el caso.
2. **Escribir el script** (`synthetic-case-<n>.cjs`) en el área privada: siembra `users/adminStores/stores/products/customers/orders` con valores sintéticos, deniega marcadores reales y verifica la huella al final.
3. **Correr contra emuladores aislados** (puertos propios, `store-os-dev`): el caso debe sembrar y auto-verificarse en verde.
4. **Registrar en la issue** el objetivo del caso, la huella verificada y el resultado; el script permanece privado.

## Caso 1 — Pedido con colores y fichas sustituidas (incidente #391)

`synthetic-case-391.cjs` (área privada del PO) reproduce el defecto que bloqueó a la operadora: pedido abierto con **dos líneas de color apuntando a una ficha eliminada** (`productId`+`variantId`, `variantColor`/`variantSku` congelados) y dos fichas de reemplazo (diseño por color con estantes) listas para sustituir. Deny-list con los marcadores reales del caso; huella estructural verificada automáticamente (colecciones, líneas, enlace a documento eliminado, fichas de reemplazo). Usado como evidencia del hotfix #393.

## Siguientes casos

- Volumen: compra de varios tickets con recepción parcial (#206/#207).
- Crédito aplicado entre pedidos hermanos (cuando #380 resuelva el contrato).
