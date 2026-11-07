import { useEffect, useState } from "react";
import { useStore, newPurchase } from "../../app/StoreProvider";
import { Button, Screen, ScreenHeader } from "../../design-system";
import { navigate } from "../../lib/router";
import { PurchaseForm } from "./PurchaseForm";
import { useListRestore } from "../../lib/listRestore";
import { PurchaseList } from "./PurchaseList";
import { SaleExpenseSummary } from "./SaleExpenseSummary";
import { effectivePurchaseStatus, type Purchase } from "../../types";

// Compras: the purchase ledger + entry into the shared editor (manual or PDF
// import — the editor offers both). The editor renders INLINE (wide) so dozens
// of lines fit comfortably; a Sheet was too narrow for real purchase reviews.
export function PurchasesScreen() {
  const { activeStore } = useStore();
  const [editing, setEditing] = useState<Purchase | null>(null);
  // #233: return from a purchase review to the same scroll position.
  const { restoreScroll } = useListRestore("purchases", {});
  useEffect(() => {
    restoreScroll();
  }, [restoreScroll]);

  if (!activeStore) return null;

  if (editing) {
    return (
      <Screen>
        <ScreenHeader
          title={effectivePurchaseStatus(editing) === "received" ? "Compra recibida" : editing.status === undefined ? "Compra" : "Editar compra"}
          subtitle="Revisa, vincula la mercancía y recibe el inventario"
          action={
            <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
              ← Compras
            </Button>
          }
        />
        <PurchaseForm purchase={editing} onDone={() => setEditing(null)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Compras"
        subtitle="Mercancía adquirida y entradas de inventario"
        action={
          <Button size="sm" onClick={() => setEditing(newPurchase(activeStore.id))}>
            + Nueva compra
          </Button>
        }
      />
      <div className="space-y-3">
        {/* #184 (corte ejecutable): visibilidad de gastos de venta del periodo. */}
        <SaleExpenseSummary />
        <PurchaseList onBack={() => navigate("/productos")} onOpen={setEditing} />
      </div>
    </Screen>
  );
}
