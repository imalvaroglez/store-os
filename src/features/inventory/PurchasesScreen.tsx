import { useState } from "react";
import { useStore, newPurchase } from "../../app/StoreProvider";
import { Button, Screen, ScreenHeader, Sheet } from "../../design-system";
import { PurchaseForm } from "./PurchaseForm";
import { PurchaseList } from "./PurchaseList";

// Purchase history + entry point, extracted from InventoryScreen (delivery
// unified-products): lives under Productos → Compras, leaving Inventario to
// stock corrections only. Moved, not rewritten.
export function PurchasesScreen() {
  const { activeStore } = useStore();
  const [creating, setCreating] = useState(false);

  if (!activeStore) return null;

  return (
    <Screen>
      <ScreenHeader
        title="Compras"
        subtitle="Historial de compras a proveedores"
        action={
          <Button size="sm" onClick={() => setCreating(true)}>
            + Compra
          </Button>
        }
      />
      <PurchaseList />
      <Sheet open={creating} onClose={() => setCreating(false)} title="Nueva compra">
        <PurchaseForm purchase={newPurchase(activeStore.id)} onDone={() => setCreating(false)} />
      </Sheet>
    </Screen>
  );
}
