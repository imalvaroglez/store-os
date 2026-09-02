import { Button, EmptyState, IconButton, ProductImage, Sheet } from "../../design-system";
import type { PublicPriceTier, PublicStockSignal, PublicStore } from "../../app/firebase/publicCatalog";
import { formatMoney, publicPrice } from "../../lib/money";
import { buildCartOrderUrl, type CartOrderLine } from "../../lib/whatsapp";
import {
  calculateOrderPricing,
  type CartQtyLine,
} from "../../lib/pricing";
import { pruneCartLines, type CartLine } from "../../lib/cart";

// Public cart drawer. Informative only: minimums are shown as invitations,
// never enforced — the owner confirms prices and qualification in the chat.

const STOCK_LEGENDS: Record<PublicStockSignal, string | null> = {
  pocas: "Quedan pocas — tu pedido puede reabastecerse y entregarse completo 💛",
  agotado: "Se puede hacer sobre pedido — te confirmamos fecha de reabastecimiento 💛",
  disponible: null,
};

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

/** Shared public price hierarchy: deepest tier is the commercial aspiration. */
export function PublicTierPrices({
  store,
  product,
  mode = "card",
}: {
  store: PublicStore;
  product: PublicPricedProduct;
  mode?: "card" | "detail";
}) {
  const tiers = [...(store.priceTiers ?? [])]
    .sort((a, b) => a.order - b.order)
    .filter((tier) => typeof product.prices?.[tier.id] === "number");

  if (tiers.length < 2) {
    return (
      <p className={`${mode === "detail" ? "text-2xl" : "text-xl"} font-semibold text-[var(--olv-accent,var(--terracotta))] mt-2`}>
        {formatMoney(publicPrice(product, store.defaultTierId ?? undefined))}
      </p>
    );
  }

  const aspirational = tiers[tiers.length - 1];
  const requirement = tierRequirement(aspirational);
  return (
    <div className={mode === "detail" ? "mt-3 rounded-xl bg-white/60 ring-1 ring-[var(--olv-rule,var(--rule))] p-4" : "mt-2"}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={`${mode === "detail" ? "text-3xl" : "text-2xl"} font-extrabold text-[var(--olv-accent,var(--terracotta))]`}>
          {formatMoney(product.prices?.[aspirational.id])}
        </span>
        <span className="font-semibold text-[var(--olv-ink,var(--ink))]">{aspirational.label}</span>
      </div>
      {requirement && (
        <p className="text-xs text-[var(--olv-ink-soft,var(--ink-soft))] mt-0.5">{requirement}</p>
      )}
      <div className={`${mode === "detail" ? "mt-3 pt-3 border-t border-[var(--olv-rule,var(--rule))]" : "mt-2"} space-y-1 text-xs`}>
        {tiers.slice(0, -1).map((tier) => {
          const minimum = tierRequirement(tier);
          return (
            <p key={tier.id} className="text-[var(--olv-ink-soft,var(--ink-soft))]">
              <span className="font-semibold text-[var(--olv-ink,var(--ink))]">{tier.label}</span>{" "}
              {formatMoney(product.prices?.[tier.id])}
              {minimum ? ` · ${minimum}` : ""}
            </p>
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
  onRemove,
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
  onRemove: (productSlug: string) => void;
}) {
  const shown = visibleSlugs ? pruneCartLines(lines, visibleSlugs) : lines;

  const tiers: PublicPriceTier[] = store.priceTiers ?? [];
  const qtyLines: CartQtyLine[] = shown.map((l) => ({ qty: l.qty, unitPrices: l.unitPrices ?? {} }));
  const pricing = calculateOrderPricing(tiers, qtyLines);
  const aspiration = pricing?.aspirationalTier;
  const intermediate = pricing && aspiration && !aspiration.qualifies
    ? pricing.tiers.find((entry) =>
        entry.tier.order > pricing.baseTier.tier.order &&
        entry.tier.order < aspiration.tier.order
      )
    : undefined;

  const orderLines: CartOrderLine[] = shown.map((l) => ({
    name: l.name,
    sku: l.sku,
    qty: l.qty,
    inquire: l.inquire || signalBySlug?.[l.productSlug] === "agotado",
  }));

  return (
    <Sheet open={open} onClose={onClose} title="Tu pedido">
      {shown.length === 0 ? (
        <EmptyState
          title="Tu pedido está vacío"
          subtitle="Agrega piezas del catálogo y envíalas en un solo mensaje."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)] md:items-start">
          <ul className="divide-y divide-[var(--olv-rule,var(--rule))] md:pr-2">
            {shown.map((l) => {
              const signal = signalBySlug?.[l.productSlug];
              const legend = signal ? STOCK_LEGENDS[signal] : null;
              return (
                <li key={l.productSlug} className="flex gap-3 py-3">
                  <ProductImage src={l.image} alt={l.name} size="thumb" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-[var(--olv-ink,var(--ink))] truncate">{l.name}</p>
                        <p className="text-xs text-[var(--olv-ink-soft,var(--ink-soft))]">{l.sku}</p>
                      </div>
                      <IconButton
                        variant="ghost"
                        aria-label="Quitar"
                        onClick={() => onRemove(l.productSlug)}
                      >
                        ✕
                      </IconButton>
                    </div>
                    {legend && <p className="text-xs text-[var(--olv-ink-soft,var(--ink-soft))] mt-1">{legend}</p>}
                    <div className="flex items-center gap-2 mt-2">
                      <IconButton
                        variant="secondary"
                        aria-label="Restar una pieza"
                        onClick={() => onSetQty(l.productSlug, l.qty - 1)}
                      >
                        −
                      </IconButton>
                      <span className="w-8 text-center font-extrabold text-[var(--olv-ink,var(--ink))]">{l.qty}</span>
                      <IconButton
                        variant="secondary"
                        aria-label="Sumar una pieza"
                        onClick={() => onSetQty(l.productSlug, l.qty + 1)}
                      >
                        +
                      </IconButton>
                      <span className="text-[var(--olv-ink-soft,var(--ink-soft))] text-xs ml-1">{l.qty === 1 ? "pieza" : "piezas"}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-col gap-3">
            {pricing ? (
              <>
              <div className="rounded-xl bg-[var(--olv-accent-soft,var(--paper-2))] ring-1 ring-[var(--olv-rule,var(--rule))] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--olv-ink,var(--ink))]">
                      Precio {pricing.activeTier.tier.label}
                      {pricing.activeTier.tier.id !== pricing.baseTier.tier.id ? " desbloqueado" : ""}
                    </p>
                    <p className="text-xs text-[var(--olv-ink-soft,var(--ink-soft))] mt-0.5">
                      {pricing.totalQuantity} {pricing.totalQuantity === 1 ? "pieza" : "piezas"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-[var(--olv-ink-soft,var(--ink-soft))]">Subtotal estimado</p>
                    <p className="text-xl font-extrabold text-[var(--olv-ink,var(--ink))]">
                      {formatMoney(pricing.estimatedSubtotal)} MXN
                    </p>
                  </div>
                </div>
                {pricing.savingsVsBase > 0 && (
                  <p className="text-sm font-semibold text-[var(--olv-ink,var(--ink))] mt-2">
                    Ahorras {formatMoney(pricing.savingsVsBase)} frente a {pricing.baseTier.tier.label}.
                  </p>
                )}
                <p className="text-xs text-[var(--olv-ink-soft,var(--ink-soft))] mt-2">Envío no incluido.</p>
              </div>

              {aspiration && (
                <div className="rounded-xl ring-2 ring-[var(--olv-accent,var(--terracotta))] bg-white/70 p-4">
                  <p className="font-extrabold text-[var(--olv-ink,var(--ink))]">
                    {aspiration.qualifies
                      ? `✨ Precio ${aspiration.tier.label} desbloqueado`
                      : `Tu meta: precio ${aspiration.tier.label}`}
                  </p>
                  {!aspiration.qualifies && aspiration.amountRemaining > 0 && (
                    <p className="text-sm text-[var(--olv-ink,var(--ink))] mt-1">
                      Te faltan {formatMoney(aspiration.amountRemaining)} en productos a precio {aspiration.tier.label}.
                    </p>
                  )}
                  {!aspiration.qualifies && aspiration.piecesRemaining > 0 && (
                    <p className="text-sm text-[var(--olv-ink,var(--ink))] mt-1">
                      Te {aspiration.piecesRemaining === 1 ? "falta" : "faltan"} {aspiration.piecesRemaining}{" "}
                      {aspiration.piecesRemaining === 1 ? "pieza" : "piezas"} para desbloquear {aspiration.tier.label}.
                    </p>
                  )}
                  {!aspiration.qualifies && aspiration.savingsVsActive > 0 && (
                    <p className="text-xs text-[var(--olv-ink-soft,var(--ink-soft))] mt-1">
                      Con {aspiration.tier.label}, lo que ya llevas costaría {formatMoney(aspiration.savingsVsActive)} menos.
                    </p>
                  )}
                  {aspiration.qualifies && aspiration.savingsVsBase > 0 && (
                    <p className="text-sm text-[var(--olv-ink,var(--ink))] mt-1">
                      Ahorras {formatMoney(aspiration.savingsVsBase)} frente a {pricing.baseTier.tier.label}.
                    </p>
                  )}
                </div>
              )}

              {intermediate && (
                <div className="rounded-lg bg-white/60 ring-1 ring-[var(--olv-rule,var(--rule))] px-3 py-2 text-sm">
                  {intermediate.qualifies ? (
                    <p className="font-semibold text-[var(--olv-ink,var(--ink))]">
                      ✨ Precio {intermediate.tier.label} desbloqueado
                    </p>
                  ) : intermediate.piecesRemaining > 0 ? (
                    <p className="text-[var(--olv-ink,var(--ink))]">
                      Te {intermediate.piecesRemaining === 1 ? "falta" : "faltan"} {intermediate.piecesRemaining}{" "}
                      {intermediate.piecesRemaining === 1 ? "pieza" : "piezas"} para desbloquear {intermediate.tier.label}.
                    </p>
                  ) : null}
                  {!intermediate.qualifies && intermediate.savingsVsActive > 0 && (
                    <p className="text-xs text-[var(--olv-ink-soft,var(--ink-soft))] mt-1">
                      Con {intermediate.tier.label}, lo que ya llevas costaría {formatMoney(intermediate.savingsVsActive)} menos.
                    </p>
                  )}
                </div>
              )}
              </>
            ) : (
              <div className="rounded-lg bg-white/60 ring-1 ring-[var(--olv-rule,var(--rule))] px-3 py-2 text-sm">
                <p className="text-[var(--olv-ink-soft,var(--ink-soft))]">
                  Te confirmo precios y existencia por WhatsApp.
                </p>
              </div>
            )}

            <a href={buildCartOrderUrl(store, store.slug, orderLines, pricing)} target="_blank" rel="noreferrer">
              <Button full size="lg" variant="primary" className="bg-[var(--olv-accent,var(--terracotta))] text-on-accent hover:opacity-90">
                Enviar pedido por WhatsApp
              </Button>
            </a>
            <p className="text-[var(--olv-ink-soft,var(--ink-soft))] text-xs text-center">
              Precio y existencia por confirmar por WhatsApp.
            </p>
          </div>
        </div>
      )}
    </Sheet>
  );
}
