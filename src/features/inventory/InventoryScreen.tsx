import { useStore } from "../../app/StoreProvider";
import {
  Badge,
  Card,
  EmptyState,
  IconButton,
  ScreenHeader,
} from "../../design-system";
import { productsForStore } from "../../lib/selectors";
import { formatMoney } from "../../lib/money";

export function InventoryScreen() {
  const { state, activeStore, upsertProduct } = useStore();
  if (!activeStore) return null;

  const products = productsForStore(state.products, activeStore.id).filter(
    (p) => typeof p.quantityOnHand === "number"
  );

  function adjust(id: string, delta: number) {
    const p = state.products.find((x) => x.id === id);
    if (!p || typeof p.quantityOnHand !== "number") return;
    upsertProduct({
      ...p,
      quantityOnHand: Math.max(0, p.quantityOnHand + delta),
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <div className="p-4">
      <ScreenHeader
        title="Inventario"
        subtitle="Ajusta la existencia con −1 / +1"
      />

      {products.length === 0 ? (
        <EmptyState
          title="Sin inventario"
          subtitle="Agrega productos con existencia para verlos aquí."
          icon={<div className="text-6xl">📦</div>}
        />
      ) : (
        <div className="space-y-3">
          {products.map((p) => {
            const low =
              typeof p.lowStockAt === "number" &&
              (p.quantityOnHand ?? 0) <= p.lowStockAt;
            return (
              <Card key={p.id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-ink truncate">{p.name}</h3>
                    <p className="text-xs text-ink-soft">Menudeo {formatMoney(p.prices?.retail)}</p>
                    {low && (
                      <div className="mt-1">
                        <Badge tone="warning">Baja existencia</Badge>
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
                      {p.quantityOnHand}
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
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
