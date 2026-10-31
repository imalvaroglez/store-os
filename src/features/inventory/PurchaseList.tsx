import { useStore } from "../../app/StoreProvider";
import { Button, Card, EmptyState, Badge } from "../../design-system";
import { purchasesForStore, suppliersForStore } from "../../lib/selectors";
import { formatMoneyExact } from "../../lib/money";
import { formatDate } from "../../lib/dates";
import {
  effectivePurchaseStatus,
  purchaseRecordedTotal,
  purchaseSourcingExpenseTotal,
  purchaseConfirmedTotal,
  type Purchase,
} from "../../types";

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
  const suppliers = suppliersForStore(state.suppliers, activeStore.id);
  const purchases = purchasesForStore(state.purchases, activeStore.id).sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? "")
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
          const supplier = suppliers.find((s) => s.id === (p.tickets?.[0]?.supplierId ?? p.supplierId));
          const tickets = p.tickets ?? [];
          const references = tickets.length ? tickets.map((ticket) => ticket.folio).filter(Boolean) : [p.supplierOrder].filter(Boolean);
          const status = effectivePurchaseStatus(p);
          const pieces = p.lines.reduce((s, l) => s + l.quantity, 0);
          const sourcingExpenseTotal = purchaseSourcingExpenseTotal(p);
          return (
            <Card key={p.id} className="cursor-pointer" onClick={() => onOpen(p)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-ink truncate">
                      {p.name || (tickets.length > 1 ? "Compra de surtido" : supplier?.name ?? tickets[0]?.supplierName ?? p.supplierName ?? "Sin proveedor")}
                    </h3>
                    {references.map((reference, index) => <span key={`${reference}:${index}`} className="text-xs text-ink-soft">#{reference}</span>)}
                    <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                  </div>
                  <p className="text-xs text-ink-soft">
                    {formatDate(p.date)} · {p.lines.length}{" "}
                    {p.lines.length === 1 ? "producto" : "productos"} · {pieces}{" "}
                    {pieces === 1 ? "pieza" : "piezas"}
                  </p>
                  {tickets.length > 1 && <p className="text-xs text-ink-soft">{tickets.length} tickets · {tickets.map((ticket) => suppliers.find((item) => item.id === ticket.supplierId)?.name ?? ticket.supplierName ?? "Sin proveedor").join(" · ")}</p>}
                  <p className="text-xs text-ink-soft mt-1 truncate">
                    {p.lines.map((l) => `${l.quantity} ${l.name}`).join(", ")}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge tone="neutral">
                    {tickets.length > 1 ? "Proveedores" : "Proveedor"} {formatMoneyExact(purchaseConfirmedTotal(p))}
                  </Badge>
                  {sourcingExpenseTotal > 0 && (
                    <p className="mt-1 text-xs text-ink-soft">
                      Gastos {formatMoneyExact(sourcingExpenseTotal)} · Total {formatMoneyExact(purchaseRecordedTotal(p))}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
