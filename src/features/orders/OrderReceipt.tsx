import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { OrderTicketData } from "./orderTicket";
import "../../design-system/receipt-print.css";

/**
 * Printable receipt (#139, spec §4): the canonical ticket as a clean letter-
 * size document the operator prints or saves as PDF with the browser dialog
 * (window.print — no libraries, no services). Money is identical to the
 * WhatsApp text by construction: both render OrderTicketData. The
 * #receipt-print-root id is what the @media print scope isolates on paper;
 * on screen it previews inside the existing "Detalle para compartir" sheet.
 */
export function OrderReceipt({ data }: { data: OrderTicketData }) {
  // The print scope only applies while a receipt is on screen — otherwise a
  // plain Ctrl+P elsewhere would print a blank page.
  useEffect(() => {
    document.body.classList.add("receipt-print-scope");
    return () => document.body.classList.remove("receipt-print-scope");
  }, []);

  return (
    <>
      {/* #405: no max-w cap — the preview fills its sheet column so it shares
       * width and height with the shared-text panel beside it. */}
      <div data-testid="receipt-preview" className="flex-1 min-w-0 rounded-card bg-surface ring-1 ring-edge p-6 [print-color-adjust:exact]">
        <ReceiptContents data={data} />
      </div>
      {createPortal(
        <div id="receipt-print-root" className="receipt-print-document rounded-card bg-surface p-6 [print-color-adjust:exact]">
          <ReceiptContents data={data} />
        </div>,
        document.body
      )}
    </>
  );
}

function ReceiptContents({ data }: { data: OrderTicketData }) {
  return (
    <>
      <header className="text-center space-y-1 border-b border-rule pb-3">
        <h2 className="text-lg font-semibold text-ink tracking-tight">{data.storeName}</h2>
        <p className="text-xs uppercase tracking-widest text-on-surface-soft">Recibo de pedido</p>
      </header>

      <p className="mt-3 text-sm text-ink">
        <span className="font-semibold">{data.customer}</span>
        {data.dateLabel && <span className="text-on-surface-soft"> · {data.dateLabel}</span>}
      </p>

      <ul className="receipt-lines mt-3 space-y-1.5">
        {data.lines.map((line) => (
          <li key={line.index} className="flex items-baseline justify-between gap-3 text-sm text-ink">
            <span className="min-w-0">
              <span className="text-on-surface-soft tabular-nums">{line.index}.</span> {line.label}
            </span>
            <span className="tabular-nums shrink-0">{line.amount}</span>
          </li>
        ))}
      </ul>

      <div className="receipt-totals mt-3 border-t border-rule pt-2 space-y-1">
        <div className="flex items-baseline justify-between gap-3 text-sm font-semibold text-ink">
          <span>Total</span>
          <span className="tabular-nums">{data.total}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-sm text-ink">
          <span>Cobrado</span>
          <span className="tabular-nums">{data.cobrado}</span>
        </div>
        {data.saldo && (
          <div className="flex items-baseline justify-between gap-3 text-sm text-ink">
            <span>Saldo</span>
            <span className="tabular-nums">{data.saldo}</span>
          </div>
        )}
        {data.availableCredit && (
          <div className="flex items-baseline justify-between gap-3 text-sm text-ink">
            <span>A tu favor</span>
            <span className="tabular-nums">{data.availableCredit}</span>
          </div>
        )}
      </div>
      {/* #405: no "Pedidos por WhatsApp" footer — the catalog is the ordering
       * channel; WhatsApp stays for sharing this very detail as text. */}
    </>
  );
}
