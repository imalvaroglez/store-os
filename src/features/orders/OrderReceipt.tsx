import { useEffect } from "react";
import type { OrderTicketData } from "./orderTicket";

/**
 * Printable receipt (#139, spec §4): the canonical ticket as a clean letter-
 * size document the operator prints or saves as PDF with the browser dialog
 * (window.print — no libraries, no services). Money is identical to the
 * WhatsApp text by construction: both render OrderTicketData. The
 * #receipt-print-root id is what the @media print scope isolates on paper;
 * on screen it previews inside the existing "Detalle para compartir" sheet.
 */
export function OrderReceipt({
  data,
  whatsapp,
}: {
  data: OrderTicketData;
  /** Store's public WhatsApp, printed as contact when available. */
  whatsapp?: string;
}) {
  // The print scope only applies while a receipt is on screen — otherwise a
  // plain Ctrl+P elsewhere would print a blank page.
  useEffect(() => {
    document.body.classList.add("receipt-print-scope");
    return () => document.body.classList.remove("receipt-print-scope");
  }, []);

  return (
    <div
      id="receipt-print-root"
      className="rounded-card bg-surface ring-1 ring-edge p-6 max-w-md mx-auto [print-color-adjust:exact] print:ring-0 print:max-w-none"
    >
      <header className="text-center space-y-1 border-b border-rule pb-3">
        <h2 className="text-lg font-semibold text-ink tracking-tight">{data.storeName}</h2>
        <p className="text-xs uppercase tracking-widest text-on-surface-soft">Recibo de pedido</p>
      </header>

      <p className="mt-3 text-sm text-ink">
        <span className="font-semibold">{data.customer}</span>
        {data.dateLabel && <span className="text-on-surface-soft"> · {data.dateLabel}</span>}
      </p>

      <ul className="mt-3 space-y-1.5">
        {data.lines.map((line) => (
          <li key={line.index} className="flex items-baseline justify-between gap-3 text-sm text-ink">
            <span className="min-w-0">
              <span className="text-on-surface-soft tabular-nums">{line.index}.</span> {line.label}
            </span>
            <span className="tabular-nums shrink-0">{line.amount}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 border-t border-rule pt-2 space-y-1">
        <div className="flex items-baseline justify-between gap-3 text-sm font-semibold text-ink">
          <span>Total</span>
          <span className="tabular-nums">{data.total}</span>
        </div>
        {data.saldo && (
          <div className="flex items-baseline justify-between gap-3 text-sm text-ink">
            <span>Saldo</span>
            <span className="tabular-nums">{data.saldo}</span>
          </div>
        )}
      </div>

      {whatsapp && (
        <footer className="mt-4 pt-2 border-t border-rule text-xs text-on-surface-soft text-center">
          Pedidos por WhatsApp: {whatsapp}
        </footer>
      )}
    </div>
  );
}
