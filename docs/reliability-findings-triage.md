# Triage del inventario de hallazgos de confiabilidad

> #376 — Disposición por hallazgo de los 19 menores reportados por los 5 auditores (2026-11-12). Cada uno queda como: **RESUELTO** (con evidencia), **ABIERTO** (candidato con impacto y criterio verificable), **HIPÓTESIS** (falta evidencia) o **OBSOLETO/DUPLICADO**. Contrastado contra el tablero (fuente única de estado) al **2026-11-14 ~21:30 UTC** — refrescar antes de usar; sin datos productivos.

Cuenta de disposición (19 hallazgos): **4 parcialmente resueltos** (4, 6, 12, 17) + **13 abiertos** (1, 2, 3, 5, 7, 9, 10, 11, 13, 14, 15, 16, 18) + **2 hipótesis** (8, 19) = 19.

## Dinero/lectura

1. **«Total» divergente tras posventa** (`payments.ts:273`) — **ABIERTO**. Impacto: lectura de dinero en Cobros vs ticket. Criterio: un pedido con reembolso confirmado muestra el mismo total en tarjeta, Cobros y ticket o la diferencia queda etiquetada. Fuente: hallazgo 1. *Nota: #373 ronda 2 endureció la evidencia de gastos, no este total.*
2. **«Falta cobrar» con dos alcances** (`orderCountsTowardToPay`) — **ABIERTO**. Impacto: la cifra de Inicio/clientes incluye cotizaciones; el chip de Pedidos no. Criterio: una sola definición documentada en pantalla o etiquetas distintas explícitas. La presentación del $0 se intentó en #406 pero la issue fue **devuelta** (ventana de $0 sin estado de carga): nada de este hallazgo está resuelto hoy.
3. **«Vendido» con total histórico** (`CustomersScreen.tsx:106-108`) — **ABIERTO**. Mismo criterio que 1.
4. **«A favor» en cancelados sin aplicar** (`orderTicket.ts:41`) — **PARCIALMENTE RESUELTO**: #414 (issue #369, **En progreso — devuelta**) oculta el dinero «a favor» como advertencia y bloquea cobros; el eje de código está aprobado y la issue espera la **decisión A/B del PO** (criterio 3: la vía de devolución del dinero ya cobrado). La etiqueta residual del ticket se revisa al integrar. **ABIERTO el matiz de UI** con criterio: el ticket nunca anuncia saldo a favor de un pedido cancelado.
5. **Iconic por dinero devuelto** (`iconic.ts:87-100`) — **ABIERTO**. Impacto: beneficio renovado con efectivo devuelto. Criterio: `isLiquidated` compara efectivo neto (acumulado menos reembolsos ejecutados).
6. **Precio por defecto del reemplazo = tier más barato** (`IncidentSheet.tsx:307`) — **PARCIALMENTE RESUELTO**: #412 (issue #364, **Por liberar** — doble revisión aprobada) reescribió el selector de reemplazo (precio visible, costo real). El default concreto se verifica al integrar; **ABIERTO con criterio**: el precio propuesto inicial nunca es un tier privado (mayoreo) sin elegirlo.

## Flujos

7. **«Entregar» con error genérico fuera del editor** (`OrderCard.tsx:91-100`) — **ABIERTO**. Criterio: el diálogo R9 alcanzable desde tarjeta/Inicio o error explicando el paso que falta.
8. **Id de intento envenenado en Cobros** — **HIPÓTESIS** (no duplica dinero). Falta: reproducción sintética con fallo+commit real y hoja cerrada a mitad. Si se reproduce: issue propia.
9. **Doble-tap «Cobrar»: toasts contradictorios** — **ABIERTO (menor)**. Criterio: estado saving en botones de tarjeta; un solo toast final.
10. **«Recibir así, con diferencia» muerto para compras con tickets** (`PurchaseForm.tsx:888`, tolerancia 0.005) — **ABIERTO**. Impacto: recepción bloqueada por centavos. Criterio: la salida existe y su botón ejecuta con diferencias de centavos documentadas.
11. **Alta desde Compras publica sin compuertas** (`ProductMiniForm` → `status: published`) — **ABIERTO**. Impacto: precio $0/foto ausente públicos. Criterio: la mini ficha publica solo con foto/categoría/precio ≥ mínimo o queda borrador. (Relacionado con #356: verificación operativa con Fer.)
12. **Ajuste rápido ± sin await/catch** (`CatalogScreen.tsx:382-391`) — **PARCIALMENTE RESUELTO**: #373 (**Por liberar** — 3 rondas, la última APROBADA con control negativo) hace persistir-antes-de-despachar en `upsertProduct` (el ajuste ya no miente). **ABIERTO el matiz UI**: toasts ante rechazo.
13. **No se puede borrar una compra borrador** (`deletePurchase` sin call-site) — **ABIERTO (menor)**. Criterio: acción con confirmación para borradores no recibidos.
14. **`where in` sin trocear >30 tiendas** (`firestoreData.ts:91,179`) — **ABIERTO** (latente: hoy pocas tiendas). Criterio: `in` troceado por 30. No explota hoy — prioridad baja.
15. **Sondeo de IDs por get de inexistentes** — **ABIERTO (mínimo)**. Decisión de apertura consciente (no ampliar aquí detalles; ver #176).
16. **Borrado con PERMISSION_DENIED crudo** (`deleteOrderWithStockTx`) — **ABIERTO**. Criterio: error en español; bloqueo explícito para pedidos con `refundOwedCents`.
17. **Dispatch-antes-de-persistir** — **PARCIALMENTE RESUELTO**: #373 (**Por liberar**) corrigió `upsertPurchase`/`upsertProduct`/membresías. **ABIERTO** para `deleteStore`/`deleteProduct`/`deletePurchase`.
18. **`releaseCustomerCreditTx` sin cap** — **ABIERTO**, en territorio del contrato #380 (sesión 1); se ejecuta con esa decisión para no duplicar el trabajo.
19. **Hipótesis vitrina/variantes y bandas/categorías secundarias** — **HIPÓTESIS**. Falta: recorrido sintético en Preview. Nota: #444 (ya integrado — subtotales por tarifa en el carrito) NO cubre variantes visibles en el carrito; el selector público de variantes por color YA ESTÁ cubierto por #137/#434 (**Por liberar**, catálogo genérico) — lo que sigue sin cubrir es la **vitrina de Olivia** (OliviaStorefront), ficha pública y bandas.

## Prioridad sugerida (dinero > acceso > inventario > pulido)

1) hallazgos 1–3 y 5 (lectura de dinero) — una sola issue de «una cifra, una verdad» con la matriz de superficies; 2) 11 (publicación sin compuertas) por ventas públicas; 3) 7, 10, 16 (bloqueos de flujo); 4) 17 restante; 5) 6/12/9/13 (matiz UI); 6) 8/19 (hipótesis a reproducir); 7) 14/15 (latentes).
