import { useCallback, useEffect, useState } from "react";
import { useListRestore } from "../../lib/listRestore";
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
import { productCreationDefaults } from "./productDefaults";
import { CATEGORY_LABELS } from "../../lib/labels";
import { productsForStore, activeCategoriesForStore } from "../../lib/selectors";
import { committedForProduct, stockAlertLevel, stockAlertText } from "../../lib/inventory";
import { isVariantProduct, totalStock } from "../../lib/variants";
import { defaultTier, tiersForStore } from "../../lib/pricing";
import type { PriceTierDef } from "../../types";
import { navigate } from "../../lib/router";
import { publicPrice, profit, formatMoney, formatMoneyPlain } from "../../lib/money";
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
  tiers,
  committed,
  onEdit,
  onDelete,
  onAdjust,
}: {
  product: Product;
  isTiered: boolean;
  tiers: PriceTierDef[];
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
  // FER-09: one derivation for the whole app (default threshold included).
  const alert = isTiered ? stockAlertLevel(product) : null;
  // #124/M5 via #355: "sin dato" is NOT "agotado" — a color design with no
  // captured shelf shows no existence line at all, never a lying 0.
  const variantStock = isVariantProduct(product) ? totalStock(product) : null;

  return (
    <Card onClick={onEdit} className="p-4 sm:p-5">
      <div className="flex gap-4">
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
              {/* #294: all levels side by side, aligned across rows — compare a
                  change without opening each piece. A missing price is shown as
                  such ("—"), never as $0. */}
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2 text-xs">
                {tiers.map((tier) => {
                  const price = product.prices?.[tier.id];
                  // #294 r2: 0 is NOT a price either — the form persists a
                  // cleared field as 0, and the app's own gates treat !(p>0)
                  // as absent. Never render «Mayoreo $0» as a legit price.
                  const hasPrice = typeof price === "number" && price > 0;
                  return (
                    <span key={tier.id} className={hasPrice ? "text-ink" : "text-on-surface-soft"}>
                      {tier.label}{" "}
                      {hasPrice
                        ? <b>{formatMoneyPlain(price)}</b>
                        : <span title="Sin precio para este nivel" aria-label="Sin precio para este nivel">—</span>}
                    </span>
                  );
                })}
              </div>
              <div className="flex gap-3 mt-1 text-xs">
                {/* #294: the default price already rides the tier row above —
                    only the stock context remains here (nothing duplicated). */}
                {isVariantProduct(product) ? (
                  variantStock != null ? (
                    <span className={alert ? "text-danger font-semibold" : "text-on-surface-soft"}>
                      Existencia: {variantStock} en {product.variants!.length}{" "}
                      {product.variants!.length === 1 ? "color" : "colores"}
                    </span>
                  ) : null
                ) : typeof product.quantityOnHand === "number" ? (
                  <span className={alert ? "text-danger font-semibold" : "text-on-surface-soft"}>
                    Existencia: {product.quantityOnHand}
                  </span>
                ) : null}
              </div>
              {/* Tiered stats + manual ± moved from the old InventoryScreen
                  (unified-products): Disponible/Comprometido/Físico right on
                  the card. stopPropagation so the buttons don't open the edit
                  sheet (the whole card is clickable). */}
              {typeof product.quantityOnHand === "number" && !isVariantProduct(product) && (
                <div className="mt-3" onClick={(e) => e.stopPropagation()}>
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
                    {alert && (
                      <Badge tone={alert === "out" ? "danger" : "warning"}>
                        {stockAlertText(product)}
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex gap-3 mt-2 text-xs">
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
      {isTiered && typeof product.quantityOnHand === "number" && (
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,.8fr)] gap-x-4 mt-4 min-w-0">
          <StatRow label="Disponible">{product.quantityOnHand}</StatRow>
          <StatRow label="Comprometido" tone={committed > 0 ? "danger" : "default"}>
            {committed}
          </StatRow>
          <StatRow label="Físico">{product.quantityOnHand + committed}</StatRow>
        </div>
      )}
    </Card>
  );
}

export function CatalogScreen() {
  const { state, activeStore, deleteProduct, upsertProduct } = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);
  // #233: keep sort/filter/scroll when returning from a product's editor.
  const { filters, setFilters, restoreScroll } = useListRestore(`products:${activeStore?.id ?? ""}:${activeStore?.type ?? ""}`, {
    sortKey: "createdAt" as SortKey, sortDesc: true as boolean, categoryFilter: "", restockOnly: false as boolean,
  });
  useEffect(() => {
    restoreScroll();
  }, [restoreScroll]);
  const sortKey = filters.sortKey as SortKey;
  const sortDesc = filters.sortDesc;
  const categoryFilter = filters.categoryFilter;
  const restockOnly = filters.restockOnly;
  const setSortKey = (next: SortKey) => setFilters((p) => ({ ...p, sortKey: next }));
  const setSortDesc = (next: boolean) => setFilters((p) => ({ ...p, sortDesc: next }));
  const setCategoryFilter = (next: string) => setFilters((p) => ({ ...p, categoryFilter: next }));
  const setRestockOnly = (next: boolean) => setFilters((p) => ({ ...p, restockOnly: next }));


  if (!activeStore) return null;
  const isTiered = activeStore.type === "inventory_tiered";
  // The store type can change while the screen stays mounted (Administrar →
  // tipo); drop a stale stock sort so the select never points at a missing option.
  const effectiveSortKey: SortKey = sortKey === "stock" && !isTiered ? "createdAt" : sortKey;
  const defaultId = defaultTier(activeStore)?.id ?? "t_retail";
  const products = productsForStore(state.products, activeStore.id);
  const categories = activeCategoriesForStore(state.categories, activeStore.id);
  // Filter matches REAL categories (categoryIds, primary or secondary) — not
  // the legacy `category` enum the badges paint. Sorting is local to this
  // screen; productsForStore (shared selector) stays untouched.
  // #344: "Por surtir" uses the SAME derivation as Inicio's card
  // (stockAlertLevel — the saved threshold or the conservative default);
  // a hand-rolled lowStockAt-only check undercounted products without an
  // explicit threshold and disagreed with the number that sent Fer here.
  const filtered = products.filter((product) =>
    (!categoryFilter || (product.categoryIds ?? []).includes(categoryFilter)) &&
    (!isTiered || !restockOnly || stockAlertLevel(product) !== null)
  );
  const sorted = [...filtered].sort((a, b) => {
    const cmp = compareBy(effectiveSortKey, a, b, defaultId);
    if (cmp !== 0) return sortDesc ? -cmp : cmp;
    return a.name.localeCompare(b.name, "es");
  });
  const filterActive = categoryFilter !== "" || (isTiered && restockOnly);
  const sortOptions = (Object.keys(SORT_DEFAULTS) as SortKey[])
    .filter((k) => k !== "stock" || isTiered)
    .map((k) => ({ value: k, label: SORT_DEFAULTS[k].label }));

  const changeSort = (next: SortKey) => {
    setSortKey(next);
    setSortDesc(SORT_DEFAULTS[next].desc);
  };

  return (
    <Screen>
      <ScreenHeader
        title="Catálogo"
        subtitle={
          filterActive
            ? `${filtered.length} de ${products.length} piezas`
            : `${products.length} ${products.length === 1 ? "producto" : "productos"}`
        }
        // #294 r2: at 390px the three actions overflowed the header (~115px
        // of horizontal scroll, «+ Agregar» invisible). Wrap to a second
        // row instead — tap targets unchanged.
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* #294: pricing strategy is reachable from the FIRST viewport —
                no hidden chevron inside a collapsed Productos sub-list. */}
            {isTiered && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/productos/estrategia")}>
                Estrategia de precios
              </Button>
            )}
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
        <div className="flex items-end gap-2 overflow-x-auto pb-1 mb-5">
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
              value={effectiveSortKey}
              onChange={changeSort}
              options={sortOptions}
            />
          </div>
          {isTiered && (
            <Button
              variant={restockOnly ? "primary" : "secondary"}
              size="sm"
              aria-pressed={restockOnly}
              onClick={() => setRestockOnly(!restockOnly)}
            >
              Por surtir
            </Button>
          )}
          <IconButton
            variant="secondary"
            aria-label={sortDesc ? "Orden descendente" : "Orden ascendente"}
            onClick={() => setSortDesc(!sortDesc)}
          >
            {sortDesc ? "↓" : "↑"}
          </IconButton>
          {filterActive && (
            <Button variant="ghost" size="sm" onClick={() => { setCategoryFilter(""); setRestockOnly(false); }}>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {sorted.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              isTiered={isTiered}
              tiers={tiersForStore(activeStore)}
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
          product={productCreationDefaults(newProduct(activeStore.id), activeStore.slug)}
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
            <Button variant="danger" onClick={async () => {
              if (deleting) {
                try {
                  await deleteProduct(deleting.id);
                } catch {
                  toast.error("No se pudo eliminar el producto. Intenta de nuevo.");
                  return;
                }
                toast.success(`«${deleting.name}» eliminado`);
              }
              setDeleting(null);
            }}>Eliminar</Button>
          </>
        }
      >
        ¿Eliminar <span className="font-semibold text-ink">{deleting?.name}</span>? Esta acción no se puede deshacer.
      </Dialog>
    </Screen>
  );
}
