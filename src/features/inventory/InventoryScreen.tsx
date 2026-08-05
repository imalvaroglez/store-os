import { useState } from "react";
import { useStore, newPurchase } from "../../app/StoreProvider";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  ScreenHeader,
  Screen,
  Sheet,
  StatRow,
} from "../../design-system";
import { productsForStore, committedForProduct } from "../../lib/selectors";
import { formatMoney } from "../../lib/money";
import { nowIso } from "../../lib/dates";
import { PurchaseForm } from "./PurchaseForm";
import { PurchaseList } from "./PurchaseList";

// Inventario: Disponible / Comprometido / Físico per product, ±1 corrections,
// "+ Compra" entry to a multi-line ticket, and the purchase history view.
export function InventoryScreen() {
  const { state, activeStore, upsertProduct } = useStore();
  const [creatingPurchase, setCreatingPurchase] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  if (!activeStore) return null;
  const products = productsForStore(state.products, activeStore.id).filter(
    (p) => typeof p.quantityOnHand === "number"
  );

  function adjust(id: string, delta: number) {
    const p = state.products.find((x) => x.id === id);
    if (!p || typeof p.quantityOnHand !== "number") return;
    // Physical-count corrections can go to 0 but not below (reservation may
    // push available negative via orders; the manual buttons floor at 0).
    upsertProduct({
      ...p,
      quantityOnHand: Math.max(0, p.quantityOnHand + delta),
      updatedAt: nowIso(),
    });
  }

  if (showHistory) {
    return (
      <Screen>
        <ScreenHeader title="Compras" subtitle="Historial de compras a proveedores" />
        <PurchaseList onBack={() => setShowHistory(false)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Inventario"
        subtitle="Disponible / comprometido / físico"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowHistory(true)}>
              Compras
            </Button>
            <Button size="sm" onClick={() => setCreatingPurchase(true)}>
              + Compra
            </Button>
          </div>
        }
      />

      {products.length === 0 ? (
        <EmptyState
          title="Sin inventario"
          subtitle="Agrega productos con existencia o registra una compra."
          icon={<div className="text-6xl">📦</div>}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {products.map((p) => {
            const available = p.quantityOnHand ?? 0;
            const committed = committedForProduct(state.orders, activeStore.id, p.id);
            const physical = available + committed;
            const low = typeof p.lowStockAt === "number" && available <= p.lowStockAt;
            return (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-ink truncate">{p.name}</h3>
                    <p className="text-xs text-ink-soft">
                      Menudeo {formatMoney(p.prices?.retail)} · costo {formatMoney(p.cost)}
                    </p>
                    {low && (
                      <div className="mt-1">
                        <Badge tone="warning">Baja existencia</Badge>
                      </div>
                    )}
                    {available < 0 && (
                      <div className="mt-1">
                        <Badge tone="danger">Faltan {Math.abs(available)}</Badge>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <IconButton
                      variant="secondary"
                      onClick={() => adjust(p.id, -1)}
                      aria-label="Restar uno"
                    >
                      −
                    </IconButton>
                    <span className="w-10 text-center text-xl font-extrabold text-ink">
                      {available}
                    </span>
                    <IconButton
                      variant="primary"
                      onClick={() => adjust(p.id, 1)}
                      aria-label="Sumar uno"
                    >
                      +
                    </IconButton>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <StatRow label="Disponible">{available}</StatRow>
                  <StatRow label="Comprometido" tone={committed > 0 ? "danger" : "default"}>
                    {committed}
                  </StatRow>
                  <StatRow label="Físico">{physical}</StatRow>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Sheet open={creatingPurchase} onClose={() => setCreatingPurchase(false)} title="Nueva compra">
        <PurchaseForm purchase={newPurchase(activeStore.id)} onDone={() => setCreatingPurchase(false)} />
      </Sheet>
    </Screen>
  );
}
