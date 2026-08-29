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
  SelectField,
  Dialog,
  StatRow,
  useToast,
} from "../../design-system";
import { ProductForm } from "./ProductForm";
import { CATEGORY_LABELS } from "../../lib/labels";
import { productsForStore, activeCategoriesForStore } from "../../lib/selectors";
import { committedForProduct } from "../../lib/inventory";
import { defaultTier } from "../../lib/pricing";
import { publicPrice, profit, formatMoney } from "../../lib/money";
import { nowIso } from "../../lib/dates";
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

type SortKey = "createdAt" | "name" | "price" | "stock";

// Natural direction per key: Fecha desc (recientes), Nombre asc, Precio asc,
// Stock asc. Ties always resolve by name ("es" collation, ascending).
const SORT_DEFAULTS: Record<SortKey, { desc: boolean; label: string }> = {
  createdAt: { desc: true, label: "Fecha" },
  name: { desc: false, label: "Nombre" },
  price: { desc: false, label: "Precio" },
  stock: { desc: false, label: "Stock" },
};

function compareBy(key: SortKey, a: Product, b: Product, defaultTierId: string): number {
  switch (key) {
    case "name":
      return a.name.localeCompare(b.name, "es");
    // Effective public price = what the card shows: default tier for tiered
    // stores, single price for on-demand. Missing prices sink to the bottom.
    case "price":
      return (
        (publicPrice(a, defaultTierId) ?? Infinity) -
        (publicPrice(b, defaultTierId) ?? Infinity)
      );
    case "stock":
      return (a.quantityOnHand ?? Infinity) - (b.quantityOnHand ?? Infinity);
    case "createdAt":
      // ISO timestamps sort lexicographically.
      return a.createdAt.localeCompare(b.createdAt);
  }
}

function ProductCard({
  product,
  isTiered,
  defaultId,
  defaultLabel,
  committed,
  onEdit,
  onDelete,
  onAdjust,
}: {
  product: Product;
  isTiered: boolean;
  defaultId: string;
  defaultLabel: string;
  committed: number;
  onEdit: () => void;
  onDelete: () => void;
  onAdjust: (delta: number) => void;
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
            <>
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
              {/* Tiered stats + manual ± moved from the old InventoryScreen
                  (unified-products): Disponible/Comprometido/Físico right on
                  the card. stopPropagation so the buttons don't open the edit
                  sheet (the whole card is clickable). */}
              {typeof product.quantityOnHand === "number" && (
                <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <IconButton
                      variant="secondary"
                      onClick={() => onAdjust(-1)}
                      aria-label="Restar uno"
                    >
                      −
                    </IconButton>
                    <span className="w-8 text-center text-lg font-extrabold text-ink">
                      {product.quantityOnHand}
                    </span>
                    <IconButton variant="primary" onClick={() => onAdjust(1)} aria-label="Sumar uno">
                      +
                    </IconButton>
                    {low && <Badge tone="warning">Baja existencia</Badge>}
                    {product.quantityOnHand < 0 && (
                      <Badge tone="danger">Faltan {Math.abs(product.quantityOnHand)}</Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <StatRow label="Disponible">{product.quantityOnHand}</StatRow>
                    <StatRow label="Comprometido" tone={committed > 0 ? "danger" : "default"}>
                      {committed}
                    </StatRow>
                    <StatRow label="Físico">{product.quantityOnHand + committed}</StatRow>
                  </div>
                </div>
              )}
            </>
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
  const { state, activeStore, deleteProduct, upsertProduct } = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDesc, setSortDesc] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState("");

  if (!activeStore) return null;
  const isTiered = activeStore.type === "inventory_tiered";
  const defaultId = defaultTier(activeStore)?.id ?? "t_retail";
  const defaultLabel = defaultTier(activeStore)?.label ?? "Menudeo";
  const products = productsForStore(state.products, activeStore.id);
  const categories = activeCategoriesForStore(state.categories, activeStore.id);
  // Filter matches REAL categories (categoryIds, primary or secondary) — not
  // the legacy `category` enum the badges paint. Sorting is local to this
  // screen; productsForStore (shared selector) stays untouched.
  const filtered = categoryFilter
    ? products.filter((p) => (p.categoryIds ?? []).includes(categoryFilter))
    : products;
  const sorted = [...filtered].sort((a, b) => {
    const cmp = compareBy(sortKey, a, b, defaultId);
    if (cmp !== 0) return sortDesc ? -cmp : cmp;
    return a.name.localeCompare(b.name, "es");
  });
  const filterActive = categoryFilter !== "";
  const sortOptions = (Object.keys(SORT_DEFAULTS) as SortKey[])
    .filter((k) => k !== "stock" || isTiered)
    .map((k) => ({ value: k, label: SORT_DEFAULTS[k].label }));

  const changeSort = (next: SortKey) => {
    setSortKey(next);
    setSortDesc(SORT_DEFAULTS[next].desc);
  };

  return (
    <Screen wide>
      <ScreenHeader
        title="Catálogo"
        subtitle={
          filterActive
            ? `${filtered.length} de ${products.length} piezas`
            : `${products.length} ${products.length === 1 ? "producto" : "productos"}`
        }
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

      {products.length > 0 && (
        <div className="flex items-end gap-2 overflow-x-auto pb-1">
          <div className="w-36 shrink-0">
            <SelectField
              label="Categoría"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={[
                { value: "", label: "Todas" },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>
          <div className="w-36 shrink-0">
            <SelectField
              label="Ordenar por"
              value={sortKey}
              onChange={changeSort}
              options={sortOptions}
            />
          </div>
          <IconButton
            variant="secondary"
            aria-label={sortDesc ? "Orden descendente" : "Orden ascendente"}
            onClick={() => setSortDesc((v) => !v)}
          >
            {sortDesc ? "↓" : "↑"}
          </IconButton>
          {filterActive && (
            <Button variant="ghost" size="sm" onClick={() => setCategoryFilter("")}>
              Limpiar
            </Button>
          )}
        </div>
      )}

      {products.length === 0 ? (
        <EmptyState
          title="Sin productos"
          subtitle="Agrega tu primer producto al catálogo."
          icon={<div className="text-6xl">🛍️</div>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Sin resultados"
          subtitle="Ningún producto en esta categoría."
          icon={<div className="text-6xl">🔍</div>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {sorted.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              isTiered={isTiered}
              defaultId={defaultId}
              defaultLabel={defaultLabel}
              committed={committedForProduct(state.orders, activeStore.id, p.id)}
              onEdit={() => setEditing(p)}
              onDelete={() => setDeleting(p)}
              onAdjust={(delta) => {
                // Physical-count corrections floor at 0 (same rule the old
                // InventoryScreen ± buttons had).
                if (typeof p.quantityOnHand !== "number") return;
                upsertProduct({
                  ...p,
                  quantityOnHand: Math.max(0, p.quantityOnHand + delta),
                  updatedAt: nowIso(),
                });
              }}
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
