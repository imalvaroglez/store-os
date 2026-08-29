import { Button, EmptyState, IconButton, ProductImage, Sheet } from "../../design-system";
import type { PublicPriceTier, PublicStockSignal, PublicStore } from "../../app/firebase/publicCatalog";
import { formatMoney } from "../../lib/money";
import { buildCartOrderUrl, type CartOrderLine } from "../../lib/whatsapp";
import {
  bestTierForCart,
  cartSavings,
  nextTierGap,
  type CartQtyLine,
} from "../../lib/pricing";
import { cartPieces, pruneCartLines, type CartLine } from "../../lib/cart";

// Public cart drawer. Informative only: minimums are shown as invitations,
// never enforced — the owner confirms prices and qualification in the chat.

const STOCK_LEGENDS: Record<PublicStockSignal, string | null> = {
  pocas: "Quedan pocas — tu pedido puede reabastecerse y entregarse completo 💛",
  agotado: "Se puede hacer sobre pedido — te confirmamos fecha de reabastecimiento 💛",
  disponible: null,
};

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
  const pieces = cartPieces(shown);

  const tiers: PublicPriceTier[] = store.priceTiers ?? [];
  const baseTierId = store.defaultTierId ?? tiers[0]?.id;
  const qtyLines: CartQtyLine[] = shown.map((l) => ({ qty: l.qty, unitPrices: l.unitPrices ?? {} }));

  // Informative tier hints: the best tier the cart already qualifies for, and
  // how far the NEXT deeper tier is (whole pieces + value at menudeo).
  let savingsLine: string | null = null;
  let gapLine: string | null = null;
  if (tiers.length > 0 && baseTierId && shown.length > 0) {
    const best = bestTierForCart(tiers, qtyLines);
    const bestId = best?.id ?? baseTierId;
    if (best && best.id !== baseTierId) {
      const savings = cartSavings(best, baseTierId, qtyLines);
      if (savings > 0) {
        savingsLine = `Con precio ${best.label} ahorras ${formatMoney(savings)} frente a menudeo.`;
      }
    }
    const deeper = tiers
      .filter((t) => t.order > bestIdOrder(tiers, bestId))
      .sort((a, b) => a.order - b.order)[0];
    if (deeper) {
      const gap = nextTierGap(deeper, baseTierId, qtyLines);
      if (gap && gap.piecesMore > 0) {
        const piezas = gap.piecesMore === 1 ? "pieza" : "piezas";
        const falta = gap.piecesMore === 1 ? "te falta" : "te faltan";
        gapLine = `A precio ${deeper.label} ${falta} ${gap.piecesMore} ${piezas} más: por ${formatMoney(
          gap.extraSpend
        )} más te llevas ${formatMoney(gap.extraValueAtBase)} de producto (a precio menudeo).`;
      }
    }
  }

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
        <div className="flex flex-col gap-3">
          <ul className="divide-y divide-[var(--olv-rule)]">
            {shown.map((l) => {
              const signal = signalBySlug?.[l.productSlug];
              const legend = signal ? STOCK_LEGENDS[signal] : null;
              return (
                <li key={l.productSlug} className="flex gap-3 py-3">
                  <ProductImage src={l.image} alt={l.name} size="thumb" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-[var(--olv-ink)] truncate">{l.name}</p>
                        <p className="text-xs olv-ink-soft">{l.sku}</p>
                      </div>
                      <IconButton
                        variant="ghost"
                        aria-label="Quitar"
                        onClick={() => onRemove(l.productSlug)}
                      >
                        ✕
                      </IconButton>
                    </div>
                    {legend && <p className="text-xs olv-ink-soft mt-1">{legend}</p>}
                    <div className="flex items-center gap-2 mt-2">
                      <IconButton
                        variant="secondary"
                        aria-label="Restar una pieza"
                        onClick={() => onSetQty(l.productSlug, l.qty - 1)}
                      >
                        −
                      </IconButton>
                      <span className="w-8 text-center font-extrabold text-[var(--olv-ink)]">{l.qty}</span>
                      <IconButton
                        variant="secondary"
                        aria-label="Sumar una pieza"
                        onClick={() => onSetQty(l.productSlug, l.qty + 1)}
                      >
                        +
                      </IconButton>
                      <span className="olv-ink-soft text-xs ml-1">{l.qty === 1 ? "pieza" : "piezas"}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Review: informative savings + next-tier gap. No totals, no commitment. */}
          <div className="rounded-lg bg-white/60 ring-1 ring-[var(--olv-rule)] px-3 py-2 text-sm">
            {savingsLine && <p className="text-[var(--olv-ink)]">{savingsLine}</p>}
            {gapLine && <p className="olv-ink-soft mt-1">{gapLine}</p>}
            {!savingsLine && !gapLine && (
              <p className="olv-ink-soft">
                Pide varias piezas: entre más llevas, mejor precio te confirmo.
              </p>
            )}
          </div>

          <a href={buildCartOrderUrl(store, store.slug, orderLines)} target="_blank" rel="noreferrer">
            <Button full size="lg" variant="primary" className="bg-[var(--olv-accent)] text-white hover:opacity-90">
              Enviar pedido por WhatsApp
            </Button>
          </a>
          <p className="olv-ink-soft text-xs text-center">
            {pieces} {pieces === 1 ? "pieza" : "piezas"} en tu pedido. Sin compromiso: te confirmo
            precios y existencia por WhatsApp.
          </p>
        </div>
      )}
    </Sheet>
  );
}

function bestIdOrder(tiers: PublicPriceTier[], id: string): number {
  return tiers.find((t) => t.id === id)?.order ?? -1;
}
