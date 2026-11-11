import { useId, useState } from "react";
import { Button, EmptyState, IconButton, ProductImage, Sheet, TextField } from "../../design-system";
import type { PublicPriceTier, PublicStockSignal, PublicStore } from "../../app/firebase/publicCatalog";
import { formatMoney, formatMoneyExact, publicPrice } from "../../lib/money";
import { buildCartOrderUrl, type CartOrderLine } from "../../lib/whatsapp";
import {
  calculateOrderPricing,
  cartRequestSummary,
  isIdentityGatedTier,
  type CartQtyLine,
} from "../../lib/pricing";
import { loadCartName, pruneCartLines, saveCartName, type CartLine } from "../../lib/cart";

// Public cart drawer. Informative only: minimums are shown as invitations,
// never enforced — the owner confirms prices and qualification in the chat.

const STOCK_LEGENDS: Record<PublicStockSignal, string | null> = {
  pocas: "Quedan pocas — tu pedido puede reabastecerse y entregarse completo 💛",
  agotado: "Se puede hacer sobre pedido — te confirmamos fecha de reabastecimiento 💛",
  disponible: null,
};

// 1.13.1: the single shared estimate notice — next to the estimates, also when
// a price is still "Por confirmar". Nothing repeated under the action.
const ESTIMATE_NOTICE =
  "Los precios son estimados. Por WhatsApp confirmamos tu beneficio, disponibilidad, total y entrega. Envío no incluido. Tu selección no reserva las piezas.";

type PublicPricedProduct = { price?: number; prices?: Record<string, number> };

function tierRequirement(tier: PublicPriceTier): string | null {
  const parts: string[] = [];
  if (tier.minPieces != null) {
    parts.push(`desde ${tier.minPieces} ${tier.minPieces === 1 ? "pieza" : "piezas"}`);
  }
  if (tier.minAmount != null) {
    parts.push(`desde ${formatMoney(tier.minAmount)} en productos a precio ${tier.label}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Visible condition for the product sheet's price ladder (1.13.1): what the
 * client needs to KNOW, phrased from the store's own configuration. An
 * identity benefit (money-gated, #130) says it depends on a standing benefit
 * — never that adding pieces unlocks it for the current request.
 */
function tierCondition(tier: PublicPriceTier): string {
  const parts: string[] = [];
  if (tier.minPieces != null) {
    parts.push(`Desde ${tier.minPieces} ${tier.minPieces === 1 ? "pieza" : "piezas"}`);
  }
  if (tier.minAmount != null) {
    parts.push(tier.minPieces == null
      ? `Con beneficio ${tier.label} vigente`
      : `Desde ${formatMoney(tier.minAmount)} en precio ${tier.label}`);
  }
  return parts.join(" · ");
}

function PriceRequirement({ tier }: { tier: PublicPriceTier }) {
  const requirement = tierRequirement(tier);
  const tooltipId = useId();
  if (!requirement) return null;
  const description = tier.minAmount != null ? `Obtén el mejor precio al comprar ${requirement}` : requirement;
  return (
    <span className="price-help-wrap">
      <IconButton
        type="button"
        variant="ghost"
        className="price-help"
        aria-label={`Cómo se obtiene el precio ${tier.label}`}
        aria-describedby={tooltipId}
        title={description}
      >
        <span aria-hidden="true" className="price-help-icon">?</span>
      </IconButton>
      <span id={tooltipId} role="tooltip" className="price-help-tooltip">{description}</span>
    </span>
  );
}

/** Shared public price hierarchy: deepest tier is the commercial aspiration. */
export function PublicTierPrices({
  store,
  product,
  mode = "card",
}: {
  store: PublicStore;
  product: PublicPricedProduct;
  mode?: "card" | "detail" | "summary";
}) {
  const tiers = [...(store.priceTiers ?? [])]
    .sort((a, b) => a.order - b.order)
    .filter((tier) => typeof product.prices?.[tier.id] === "number" && Number.isFinite(product.prices[tier.id]));

  // The grid shows one informative price; qualification remains in the detail/bag.
  if (mode === "summary") {
    const amounts = tiers.map((tier) => product.prices?.[tier.id]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const amount = amounts.length > 0 ? Math.min(...amounts) : publicPrice(product, store.defaultTierId ?? undefined);
    if (amount == null || !Number.isFinite(amount)) return <p className="olv-product-price">Consultar precio</p>;
    const unrestricted = tiers.some((tier) => product.prices?.[tier.id] === amount && !tierRequirement(tier));
    const varies = amounts.some((value) => value !== amount) || (amounts.length > 0 && !unrestricted);
    return <p className="olv-product-price">{varies ? "Desde " : ""}{formatMoney(amount)}</p>;
  }

  if (tiers.length === 0 || (tiers.length === 1 && mode === "card")) {
    const amount = publicPrice(product, store.defaultTierId ?? undefined);
    return (
      <p className={`olv-price-single ${mode === "detail" ? "text-2xl" : "text-xl"} font-semibold text-[var(--olv-accent,var(--terracotta))] mt-2`}>
        {amount == null || !Number.isFinite(amount) ? "Consultar precio" : formatMoney(amount)}
      </p>
    );
  }

  const base = tiers[0];
  const aspirational = tiers[tiers.length - 1];
  const basePrice = product.prices?.[base.id];
  const aspirationalPrice = product.prices?.[aspirational.id];
  const savings = typeof basePrice === "number" && typeof aspirationalPrice === "number" && basePrice > aspirationalPrice
    ? basePrice - aspirationalPrice
    : null;

  if (mode === "detail") {
    const identityAspirational = isIdentityGatedTier(aspirational);
    return (
      <section className="olv-price-block olv-price-detail mt-3" aria-label="Precios por pieza">
        <p className="olv-price-caption">Precio por pieza</p>
        {/* 1.13.1: one 3-column ladder — level, amount on a shared axis,
            condition visible. No "?" help, no floating tooltip, no title. */}
        <dl className="olv-price-ladder">
          {tiers.map((tier) => {
            const featured = tier.id === aspirational.id;
            return (
              <div key={tier.id} className={`olv-price-row${featured ? " olv-price-row--featured" : ""}`}>
                <dt className="olv-price-row-label">{tier.label}</dt>
                <dd className="olv-price-row-amount">{formatMoney(product.prices?.[tier.id])}</dd>
                <dd className="olv-price-row-condition">{tierCondition(tier)}</dd>
              </div>
            );
          })}
        </dl>
        {savings !== null && (
          <p className="olv-price-savings">
            {identityAspirational
              ? `Hasta ${formatMoney(savings)} menos por pieza con beneficio ${aspirational.label} vigente`
              : `Hasta ${formatMoney(savings)} menos por pieza al desbloquear ${aspirational.label}`}
          </p>
        )}
      </section>
    );
  }

  return (
    <div className="olv-price-block olv-price-card mt-2">
      <div className="olv-price-card-main">
        <div className="olv-price-card-primary">
          <span className="olv-price-card-amount text-2xl font-extrabold text-[var(--olv-accent,var(--terracotta))]">
            {formatMoney(product.prices?.[aspirational.id])}
          </span>
          <span className="olv-price-card-tier font-semibold text-[var(--olv-ink,var(--ink))]">{aspirational.label}</span>
        </div>
        <PriceRequirement tier={aspirational} />
      </div>
      <p className={`olv-price-savings${savings === null ? " olv-price-savings--empty" : ""}`} aria-hidden={savings === null}>
        {savings !== null ? `Hasta ${formatMoney(savings)} menos por pieza al desbloquear ${aspirational.label}` : null}
      </p>
      <div className="olv-price-compare">
        {tiers.slice(0, -1).map((tier) => {
          const minimum = tierRequirement(tier);
          return (
            <span key={tier.id} className="olv-price-compare-item text-[var(--olv-ink-soft,var(--ink-soft))]">
              <span className="olv-price-compare-detail">
                <span className="olv-price-compare-label font-semibold text-[var(--olv-ink,var(--ink))]">{tier.label}</span>
                <span className="olv-price-compare-amount">{formatMoney(product.prices?.[tier.id])}</span>
              </span>
              {minimum && <PriceRequirement tier={tier} />}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function CartProductControl({
  productSlug,
  productName,
  quantity,
  onAdd,
  onSetQty,
  full = false,
  size = "sm",
  className = "",
}: {
  productSlug: string;
  productName: string;
  quantity: number;
  onAdd: () => void;
  onSetQty: (productSlug: string, quantity: number) => void;
  full?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (quantity <= 0) {
    return (
      <Button full={full} size={size} variant="secondary" onClick={onAdd} className={className}>
        Agregar al carrito
      </Button>
    );
  }

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-xl ring-2 ring-[var(--olv-accent,var(--terracotta))] px-1 py-1 ${className}`}
      style={{ animation: "dialogPop var(--motion-base) var(--ease-spring)" }}
      role="group"
      aria-label={`Cantidad de ${productName}`}
    >
      <IconButton
        variant="secondary"
        aria-label={`Restar una pieza de ${productName}`}
        onClick={() => onSetQty(productSlug, quantity - 1)}
      >
        −
      </IconButton>
      <span className="min-w-8 text-center font-extrabold text-ink" aria-live="polite">
        {quantity}
      </span>
      <IconButton
        variant="primary"
        aria-label={`Sumar una pieza de ${productName}`}
        onClick={() => onSetQty(productSlug, quantity + 1)}
      >
        +
      </IconButton>
    </div>
  );
}

export function CartFloatingButton({ pieces, onClick, className = "" }: {
  pieces: number;
  onClick: () => void;
  className?: string;
}) {
  if (pieces <= 0) return null;
  return (
    <Button
      variant="primary"
      aria-label="Abrir pedido"
      onClick={onClick}
      className={`fixed bottom-4 left-4 right-4 z-20 shadow-lg md:left-auto md:right-5 md:w-auto ${className}`}
      style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
    >
      🛍 Ver pedido · {pieces} {pieces === 1 ? "pieza" : "piezas"}
    </Button>
  );
}

export function CartDrawer({
  open,
  onClose,
  store,
  lines,
  signalBySlug,
  visibleSlugs,
  onSetQty,
  categoryNameBySlug,
}: {
  open: boolean;
  onClose: () => void;
  store: PublicStore;
  lines: CartLine[];
  /** Fresh stock signal per piece, when the current view knows it. */
  signalBySlug?: Record<string, PublicStockSignal>;
  /** Piece slugs of the full public catalog, when known (store view); lines for
   *  pieces no longer projected are dropped silently. */
  visibleSlugs?: Set<string>;
  onSetQty: (productSlug: string, qty: number) => void;
  /** #305: primary public category name per product slug (from the already
   * downloaded catalog projection) for the WhatsApp grouping. */
  categoryNameBySlug?: Record<string, string>;
}) {
  const shown = visibleSlugs ? pruneCartLines(lines, visibleSlugs) : lines;
  const [customerName, setCustomerName] = useState(() => loadCartName(store.slug));

  const tiers: PublicPriceTier[] = store.priceTiers ?? [];
  const qtyLines: CartQtyLine[] = shown.map((l) => ({ qty: l.qty, unitPrices: l.unitPrices ?? {} }));
  // #305: the request summary — habitual (non-identity) headline + the
  // conditional identity row. Drives BOTH the drawer rows and the message.
  const request = cartRequestSummary(tiers, qtyLines);
  const pricing = calculateOrderPricing(tiers, qtyLines);

  const orderLines: CartOrderLine[] = shown.map((l) => ({
    name: l.name,
    qty: l.qty,
    inquire: l.inquire || signalBySlug?.[l.productSlug] === "agotado",
    category: categoryNameBySlug?.[l.productSlug],
  }));

  return (
    <Sheet open={open} onClose={onClose} title="Tu pedido" className="olv-cart-sheet" contentClassName="olv-cart-sheet-content">
      {shown.length === 0 ? (
        <EmptyState
          title="Tu pedido está vacío"
          subtitle="Agrega piezas del catálogo y envíalas en un solo mensaje."
        />
      ) : (
        <div className="olv-cart-layout grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)] md:items-start">
          <ul className="divide-y divide-[var(--olv-rule,var(--rule))] md:pr-2">
            {shown.map((l, index) => {
              const signal = signalBySlug?.[l.productSlug];
              const legend = signal ? STOCK_LEGENDS[signal] : null;
              // #305/1.13.1: lines share the summary's single derivation —
              // the habitual tier, never a divergent active/identity tier.
              const linePricing = request?.lineBreakdown[index];
              const unitPrice = linePricing?.unitPrice ?? l.unitPrice;
              const lineSubtotal = linePricing?.subtotal ?? (typeof unitPrice === "number" ? unitPrice * l.qty : undefined);
              return (
                <li key={l.productSlug} className="olv-cart-line flex gap-3 py-3">
                  {/* 1.13.1: neutral thumbnail — no decorative ring/background
                      in rest; focus stays for interactive controls only. */}
                  <ProductImage src={l.image} alt={l.name} size="thumb" natural />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-[var(--olv-ink,var(--ink))] truncate">{l.name}</p>
                      </div>
                    </div>
                    {legend && <p className="text-xs text-[var(--olv-ink-soft,var(--ink-soft))] mt-1">{legend}</p>}
                    <div className="olv-cart-line-summary">
                      <div className="olv-cart-line-quantity">
                        <div className="flex items-center gap-2">
                          <IconButton
                            variant="secondary"
                            aria-label={`Restar una pieza de ${l.name}`}
                            onClick={() => onSetQty(l.productSlug, l.qty - 1)}
                          >
                            −
                          </IconButton>
                          <span className="w-8 text-center font-extrabold text-[var(--olv-ink,var(--ink))] tabular-nums" aria-live="polite">{l.qty}</span>
                          <IconButton
                            variant="secondary"
                            aria-label={`Sumar una pieza de ${l.name}`}
                            onClick={() => onSetQty(l.productSlug, l.qty + 1)}
                          >
                            +
                          </IconButton>
                        </div>
                      </div>
                      <dl className="olv-cart-line-prices">
                        <div>
                          <dt>Precio por pieza</dt>
                          <dd>{typeof unitPrice === "number" ? formatMoneyExact(unitPrice) : "Por confirmar"}</dd>
                        </div>
                        <div>
                          <dt>Subtotal</dt>
                          <dd>{typeof lineSubtotal === "number" ? formatMoneyExact(lineSubtotal) : "Por confirmar"}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="olv-cart-summary flex flex-col gap-3">
            {request ? (
              <div className="rounded-xl bg-[var(--olv-accent-soft,var(--paper-2))] ring-1 ring-[var(--olv-rule,var(--rule))] p-4">
                <p className="font-semibold text-[var(--olv-ink,var(--ink))]">
                  Tu solicitud a {store.name}
                </p>
                <p className="text-xs text-[var(--olv-ink-soft,var(--ink-soft))] mt-0.5">
                  {request.totalQuantity} {request.totalQuantity === 1 ? "pieza" : "piezas"}
                </p>
                <dl className="mt-3 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-sm text-[var(--olv-ink,var(--ink))]">Subtotal estimado</dt>
                    <dd className="text-xl font-extrabold text-[var(--olv-ink,var(--ink))] tabular-nums text-right">
                      {formatMoneyExact(request.habitualSubtotal)} MXN
                    </dd>
                  </div>
                  {request.showIdentityHint && request.identityTier && (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-sm text-[var(--olv-ink-soft,var(--ink-soft))]">
                        ¿Eres {request.identityTier.label}? Subtotal estimado
                      </dt>
                      <dd className="text-sm font-semibold text-[var(--olv-ink,var(--ink))] tabular-nums text-right">
                        {request.identitySubtotal != null ? `${formatMoneyExact(request.identitySubtotal)} MXN` : "Por confirmar"}
                      </dd>
                    </div>
                  )}
                </dl>
                <p className="text-xs text-[var(--olv-ink-soft,var(--ink-soft))] mt-3">{ESTIMATE_NOTICE}</p>
              </div>
            ) : pricing ? (
              <div className="rounded-lg bg-white/60 ring-1 ring-[var(--olv-rule,var(--rule))] px-3 py-2 text-sm">
                <p className="text-[var(--olv-ink-soft,var(--ink-soft))]">{ESTIMATE_NOTICE}</p>
              </div>
            ) : null}
            {/* 1.13.1: visual label retired — placeholder carries the hint, the
                accessible name stays "Tu nombre". */}
            <TextField
              label="Tu nombre"
              labelClassName="sr-only"
              placeholder="Escribe tu nombre para identificarte"
              value={customerName}
              onChange={(event) => {
                setCustomerName(event.target.value);
                saveCartName(store.slug, event.target.value);
              }}
            />
            <a href={buildCartOrderUrl(store, store.slug, orderLines, undefined, customerName, request)} target="_blank" rel="noreferrer">
              <Button full size="lg" variant="primary" className="bg-[var(--olv-accent,var(--terracotta))] text-on-accent hover:opacity-90">
                Enviar solicitud por WhatsApp
              </Button>
            </a>
          </div>
        </div>
      )}
    </Sheet>
  );
}
