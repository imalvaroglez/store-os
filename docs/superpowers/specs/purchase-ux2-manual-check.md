# Aceptación manual — purchase-ux2-fast-receive (PDF real)

Protocolo para la dueña/PO. Meta: **revisar las 50 líneas de un recibo real en
menos de 5 minutos en escritorio**; móvil completa el flujo sin desbordes.

## Preparación (una vez)

1. Inicia sesión en el ambiente **Preview** del PR (o dev con backend dev).
2. Tienda Olivia (inventario y precios) → Productos → **Compras** → **+ Nueva compra**.
3. Sube el PDF real del proveedor (Colore, pedido 3023, 5 páginas).
4. Espera el OCR (~30–60 s) y confirma que la tabla muestre **50 líneas**.

## Escritorio — cronómetro en marcha

1. Aparece "Hay 50 importes sin interpretar". Pulsa **Unitarios** (o *Total por
   línea* según el documento) y verifica que los costos unitarios cambien.
2. Verifica que los contadores (Importes / Sin vincular / Vinculadas) sumen 50
   y sean mutuamente excluyentes al filtrar.
3. Pulsa **Crear 50 productos** y confirma el toast "50 productos creados y
   vinculados". Las líneas pasan a *Nuevos*.
4. Si hay diferencia vs el total pagado: confírmala con el botón del aviso.
5. Pulsa **Recibir mercancía** → toast "el inventario se actualizó".
6. **Detén el cronómetro.** Registra el tiempo y cualquier fricción.

## Móvil (viewport ~390 px)

1. Abre la misma compra (o importa otro PDF).
2. Verifica filas de **dos niveles**: arriba estado+nombre+importe; abajo
   cantidad/costo/quitar y el selector con *Crear nuevo producto…*.
3. Sin scroll horizontal obligatorio; controles tocables (~40 px).
4. El footer fijo muestra total y diferencia; el motivo de bloqueo es visible.
5. Completa resolución → crear → recibir.

## Criterios de éxito

- [ ] Escritorio < 5:00 de punta a punta.
- [ ] Exactly 50 líneas tras el OCR.
- [ ] Cero desbordes/controles inaccesibles en móvil.
- [ ] Inventario correcto tras recibir (spot-check de existencias y costos).
- [ ] La compra recibida queda bloqueada (inputs deshabilitados).

Registra resultado (tiempo + incidencias) en este archivo o en el PR.
