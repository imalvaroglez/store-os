import type { ReactNode } from "react";
import { formatMoney, formatMoneyExact } from "../lib/money";

// Money renders in the display serif with tabular figures so amounts feel
// weighty and columns align — a ledger, not a dashboard.
export function Money({
  amount,
  className = "",
  muted = false,
  exact = false,
}: {
  amount: number | undefined | null;
  className?: string;
  muted?: boolean;
  exact?: boolean;
}) {
  return (
    <span className={`serif-display tnum ${muted ? "text-on-surface-soft" : ""} ${className}`}>
      {exact ? formatMoneyExact(amount) : formatMoney(amount)}
    </span>
  );
}

// A label + value row used inside cards (e.g. Total / Falta cobrar / Ganancia).
export function StatRow({
  label,
  children,
  tone,
}: {
  label: string;
  children: ReactNode;
  tone?: "default" | "danger" | "success";
}) {
  const valueColor =
    tone === "danger"
      ? "font-bold text-danger"
      : tone === "success"
      ? "font-semibold text-success"
      : "font-bold text-on-surface";
  return (
    <div className="min-w-0">
      <span className="text-on-surface-soft text-[11px] uppercase tracking-wide leading-tight break-words block">
        {label}
      </span>
      <span className={`serif-display tnum ${valueColor}`}>{children}</span>
    </div>
  );
}
