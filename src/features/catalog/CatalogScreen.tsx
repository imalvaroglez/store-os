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
  Dropdown,
  DropdownItem,
  DropdownSeparator,
  IconButton,
  Dialog,
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
  onDelete,
}: {
  product: Product;
  isTiered: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
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
            <div className="flex flex-col gap-1 min-w-0">
              <h3 className="font-semibold text-ink truncate">{product.name}</h3>
              <Badge tone={product.isPublic ? "success" : "neutral"}>
                {product.isPublic ? "Público" : "Privado"}
              </Badge>
            </div>
            {/* Stop propagation so opening the menu / picking an item does not
                also trigger the card's onClick (edit). */}
            <div onClick={(e) => e.stopPropagation()}>
              <Dropdown
                open={menu}
                onClose={() => setMenu(false)}
                trigger={
                  <IconButton
                    variant="ghost"
                    aria-label="Acciones"
                    onClick={() => setMenu((v) => !v)}
                    className="text-xl -mr-1"
                  >
                    ⋯
                  </IconButton>
                }
              >
                <DropdownItem onClick={() => { setMenu(false); onEdit(); }}>Editar</DropdownItem>
                <DropdownSeparator />
                <DropdownItem tone="danger" onClick={() => { setMenu(false); onDelete(); }}>Eliminar</DropdownItem>
              </Dropdown>
            </div>
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
  const { state, activeStore, deleteProduct } = useStore();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);

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
              onDelete={() => setDeleting(p)}
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

      <Dialog
        open={deleting !== null}
        title="Eliminar producto"
        tone="danger"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button variant="danger" onClick={() => { if (deleting) deleteProduct(deleting.id); setDeleting(null); }}>Eliminar</Button>
          </>
        }
      >
        ¿Eliminar <span className="font-semibold text-ink">{deleting?.name}</span>? Esta acción no se puede deshacer.
      </Dialog>
    </Screen>
  );
}
