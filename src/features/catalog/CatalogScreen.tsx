import { useState } from "react";
import { useStore, newProduct } from "../../app/StoreProvider";
import {
  Button,
  Card,
  Badge,
  EmptyState,
  ScreenHeader,
  Screen,
  Sheet,
  ProductImage,
} from "../../design-system";
import { ProductForm } from "./ProductForm";
import { CATEGORY_LABELS } from "../../lib/labels";
import { productsForStore } from "../../lib/selectors";
import { publicPrice, profit, formatMoney } from "../../lib/money";
import type { Product } from "../../types";

function ProductCard({
  product,
  isTiered,
  onEdit,
}: {
  product: Product;
  isTiered: boolean;
  onEdit: () => void;
}) {
  const p = publicPrice(product);
  const est = p != null ? profit(p, product.cost) : undefined;
  const low =
    isTiered &&
    typeof product.quantityOnHand === "number" &&
    typeof product.lowStockAt === "number" &&
    product.quantityOnHand <= product.lowStockAt;

  return (
    <Card onClick={onEdit}>
      <div className="flex gap-3">
        <ProductImage src={product.imageUrl} alt={product.name} size="thumb" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-ink truncate">{product.name}</h3>
            <Badge tone={product.isPublic ? "success" : "neutral"}>
              {product.isPublic ? "Público" : "Privado"}
            </Badge>
          </div>
          <p className="text-xs text-ink-soft">{CATEGORY_LABELS[product.category]}</p>

          {isTiered ? (
            <div className="flex gap-3 mt-1.5 text-xs">
              <span className="text-ink">
                Menudeo <b>{formatMoney(product.prices?.retail)}</b>
              </span>
              {typeof product.quantityOnHand === "number" && (
                <span className={low ? "text-danger font-semibold" : "text-on-surface-soft"}>
                  Existencia: {product.quantityOnHand}
                </span>
              )}
            </div>
          ) : (
            <div className="flex gap-3 mt-1.5 text-xs">
              <span className="text-ink">
                Precio <b>{formatMoney(product.price)}</b>
              </span>
              {est != null && (
                <span className="text-success">Ganancia {formatMoney(est)}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export function CatalogScreen() {
  const { state, activeStore } = useStore();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);

  if (!activeStore) return null;
  const isTiered = activeStore.type === "inventory_tiered";
  const products = productsForStore(state.products, activeStore.id);

  return (
    <Screen wide>
      <ScreenHeader
        title="Catálogo"
        subtitle={`${products.length} ${products.length === 1 ? "producto" : "productos"}`}
        action={
          <Button onClick={() => setCreating(true)}>+ Agregar</Button>
        }
      />

      {products.length === 0 ? (
        <EmptyState
          title="Sin productos"
          subtitle="Agrega tu primer producto al catálogo."
          icon={<div className="text-6xl">🛍️</div>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              isTiered={isTiered}
              onEdit={() => setEditing(p)}
            />
          ))}
        </div>
      )}

      <Sheet
        open={creating}
        onClose={() => setCreating(false)}
        title="Agregar producto"
      >
        <ProductForm
          product={newProduct(activeStore.id)}
          onDone={() => setCreating(false)}
        />
      </Sheet>

      {editing && (
        <Sheet open onClose={() => setEditing(null)} title="Editar producto">
          <ProductForm product={editing} onDone={() => setEditing(null)} />
        </Sheet>
      )}
    </Screen>
  );
}
