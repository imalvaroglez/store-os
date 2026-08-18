import { useStore } from "../../app/StoreProvider";
import { Button, Card, EmptyState, Badge } from "../../design-system";
import { purchasesForStore } from "../../lib/selectors";
import { formatMoney } from "../../lib/money";
import { formatDate } from "../../lib/dates";

// Purchase history — the cost/stock ledger (each line stores unitCost + date +
// productId). Newest first. Reached from the Inventario screen ("Compras").
export function PurchaseList({ onBack }: { onBack?: () => void }) {
  const { state, activeStore } = useStore();
  if (!activeStore) return null;
  const purchases = purchasesForStore(state.purchases, activeStore.id).sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← Inventario
          </Button>
        )}
      </div>
      {purchases.length === 0 ? (
        <EmptyState
          title="Sin compras registradas"
          subtitle="Registra tu primera compra con «+ Compra»."
        />
      ) : (
        purchases.map((p) => {
          const supplier = state.suppliers.find((s) => s.id === p.supplierId);
          return (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-ink truncate">
                    {supplier?.name ?? "Sin proveedor"}
                  </h3>
                  <p className="text-xs text-ink-soft">
                    {formatDate(p.date)} · {p.lines.length}{" "}
                    {p.lines.length === 1 ? "pieza" : "piezas"}
                  </p>
                  <p className="text-xs text-ink-soft mt-1 truncate">
                    {p.lines.map((l) => `${l.quantity} ${l.name}`).join(", ")}
                  </p>
                </div>
                <Badge tone="neutral">{formatMoney(p.totalConfirmed || p.subtotal)}</Badge>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
