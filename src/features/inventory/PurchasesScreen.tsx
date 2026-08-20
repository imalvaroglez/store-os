import { useState } from "react";
import { useStore, newPurchase } from "../../app/StoreProvider";
import { Button, Screen, ScreenHeader, Sheet } from "../../design-system";
import { navigate } from "../../lib/router";
import { PurchaseForm } from "./PurchaseForm";
import { PurchaseList } from "./PurchaseList";

// Compras: purchase history + "+ Compra" ticket entry. Extracted from the old
// InventoryScreen (unified-products) — the forms and list are unchanged.
export function PurchasesScreen() {
  const { activeStore } = useStore();
  const [creatingPurchase, setCreatingPurchase] = useState(false);

  if (!activeStore) return null;

  return (
    <Screen>
      <ScreenHeader
        title="Compras"
        subtitle="Historial de compras a proveedores"
        action={
          <Button size="sm" onClick={() => setCreatingPurchase(true)}>
            + Compra
          </Button>
        }
      />
      <PurchaseList onBack={() => navigate("/productos")} />

      <Sheet open={creatingPurchase} onClose={() => setCreatingPurchase(false)} title="Nueva compra">
        <PurchaseForm purchase={newPurchase(activeStore.id)} onDone={() => setCreatingPurchase(false)} />
      </Sheet>
    </Screen>
  );
}
