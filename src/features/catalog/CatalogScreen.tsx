import { useCallback, useState } from "react";
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
  useToast,
} from "../../design-system";
import { ProductForm } from "./ProductForm";
import { CATEGORY_LABELS } from "../../lib/labels";
import { productsForStore } from "../../lib/selectors";
import { defaultTier } from "../../lib/pricing";
import { publicPrice, profit, formatMoney } from "../../lib/money";
import type { Product } from "../../types";
import type { StatusTone } from "../../design-system";

// Primary gallery image for the thumb (first isPrimary, else first image, else
// legacy imageUrl). Never leaks private fields — imageUrl is public by design.
function primaryThumb(p: Product): string | undefined {
  const imgs = p.images;
  if (imgs && imgs.length > 0) {
    return (imgs.find((i) => i.isPrimary) ?? imgs[0]).url;
  }
  return p.imageUrl;
}

// Governed by `status` only — matches selectors.publicProductsForStore (the
// source of truth for the public catalog). isPublic is legacy and ignored here
// to avoid the "Privado" ambiguity (a published product with isPublic=false was
// shown in the catalog but badged "Privado" in admin). draft = Borrador (not
// visible), published = Publicado (visible), archived = Archivado.
function statusLabel(p: Product): string {
  if (p.status === "draft") return "Borrador";
  if (p.status === "archived") return "Archivado";
  return "Publicado";
}
function statusTone(p: Product): StatusTone {
  if (p.status === "draft") return "neutral";
  if (p.status === "archived") return "neutral";
  return "success";
}

function ProductCard({
  product,
  isTiered,
  defaultId,
  defaultLabel,
  onEdit,
  onDelete,
}: {
  product: Product;
  isTiered: boolean;
  defaultId: string;
  defaultLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState(false);
  // Stable callback so the Dropdown effect (which depends on `onClose`) does not
  // tear down and re-add its listeners on every parent render while open.
  const closeMenu = useCallback(() => setMenu(false), []);
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
        <ProductImage src={primaryThumb(product)} alt={product.name} size="thumb" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1 min-w-0">
              <h3 className="font-semibold text-ink truncate">{product.name}</h3>
              <div className="flex gap-1 flex-wrap">
                <Badge tone={statusTone(product)}>{statusLabel(product)}</Badge>
                {product.isFeatured && <Badge tone="accent">★</Badge>}
                {product.isNew && <Badge tone="info">Nuevo</Badge>}
              </div>
            </div>
            {/* Stop propagation so opening the menu / picking an item does not
                also trigger the card's onClick (edit). */}
            <div onClick={(e) => e.stopPropagation()}>
              <Dropdown
                open={menu}
                onClose={closeMenu}
                trigger={
                  <IconButton
                    variant="ghost"
                    aria-label="Acciones"
                    aria-haspopup="menu"
                    aria-expanded={menu}
                    onClick={() => setMenu((v) => !v)}
                    className="text-xl -mr-1"
                  >
                    ⋯
                  </IconButton>
                }
              >
                <DropdownItem onClick={() => { closeMenu(); onEdit(); }}>Editar</DropdownItem>
                <DropdownSeparator />
                <DropdownItem tone="danger" onClick={() => { closeMenu(); onDelete(); }}>Eliminar</DropdownItem>
              </Dropdown>
            </div>
          </div>
          <p className="text-xs text-ink-soft">{CATEGORY_LABELS[product.category]}</p>

          {isTiered ? (
            <div className="flex gap-3 mt-1.5 text-xs">
              <span className="text-ink">
                {defaultLabel} <b>{formatMoney(product.prices?.[defaultId])}</b>
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
  const toast = useToast();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);

  if (!activeStore) return null;
  const isTiered = activeStore.type === "inventory_tiered";
  const defaultId = defaultTier(activeStore)?.id ?? "t_retail";
  const defaultLabel = defaultTier(activeStore)?.label ?? "Menudeo";
  const products = productsForStore(state.products, activeStore.id);

  return (
    <Screen wide>
      <ScreenHeader
        title="Catálogo"
        subtitle={`${products.length} ${products.length === 1 ? "producto" : "productos"}`}
        action={
          <div className="flex items-center gap-2">
            {/* Preview what clients see — opens the public storefront in a new tab. */}
            <a
              href={`/catalogo/${activeStore.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="secondary" size="sm">Ver público</Button>
            </a>
            <Button onClick={() => setCreating(true)}>+ Agregar</Button>
          </div>
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
              defaultId={defaultId}
              defaultLabel={defaultLabel}
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
            <Button variant="danger" onClick={() => { if (deleting) { deleteProduct(deleting.id); toast.success(`«${deleting.name}» eliminado`); } setDeleting(null); }}>Eliminar</Button>
          </>
        }
      >
        ¿Eliminar <span className="font-semibold text-ink">{deleting?.name}</span>? Esta acción no se puede deshacer.
      </Dialog>
    </Screen>
  );
}
