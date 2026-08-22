import { useStore } from "../../app/StoreProvider";
import { Button, Card, EmptyState, Badge } from "../../design-system";
import { purchasesForStore } from "../../lib/selectors";
import { formatMoney } from "../../lib/money";
import { formatDate } from "../../lib/dates";
import { effectivePurchaseStatus, type Purchase } from "../../types";

// Purchase history — the cost/stock evidence (each line stores unitCost +
// date + productId). Newest first. Click opens the purchase in the shared
// editor (received ones render read-only there).
const STATUS_TONE: Record<string, "success" | "warning" | "info" | "neutral"> = {
  received: "success",
  needs_review: "warning",
  ready: "info",
  draft: "neutral",
};
const STATUS_LABEL: Record<string, string> = {
  received: "Recibida",
  needs_review: "Revisar",
  ready: "Lista",
  draft: "Borrador",
};

export function PurchaseList({
  onBack,
  onOpen,
}: {
  onBack: () => void;
  onOpen: (p: Purchase) => void;
}) {
  const { state, activeStore } = useStore();
  if (!activeStore) return null;
  const purchases = purchasesForStore(state.purchases, activeStore.id).sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Productos
        </Button>
      </div>
      {purchases.length === 0 ? (
        <EmptyState
          title="Registra tus compras a proveedores"
          subtitle="Lleva el costo y la entrada de mercancía al inventario. Puedes capturarla a mano o importar el PDF del pedido."
        />
      ) : (
        purchases.map((p) => {
          const supplier = state.suppliers.find((s) => s.id === p.supplierId);
          const status = effectivePurchaseStatus(p);
          const pieces = p.lines.reduce((s, l) => s + l.quantity, 0);
          return (
            <Card key={p.id} className="cursor-pointer" onClick={() => onOpen(p)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-ink truncate">
                      {supplier?.name ?? p.supplierName ?? "Sin proveedor"}
                    </h3>
                    {p.supplierOrder && (
                      <span className="text-xs text-ink-soft">#{p.supplierOrder}</span>
                    )}
                    <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                  </div>
                  <p className="text-xs text-ink-soft">
                    {formatDate(p.date)} · {p.lines.length}{" "}
                    {p.lines.length === 1 ? "producto" : "productos"} · {pieces}{" "}
                    {pieces === 1 ? "pieza" : "piezas"}
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
