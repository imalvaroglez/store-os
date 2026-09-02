import type { ReactNode } from "react";

// Screen content wrapper. One width for every view: the main area IS the
// resource (owner mandate: use the available space — Pedidos is the reference
// grammar). Forms that need a reading width wrap themselves in
// `mx-auto max-w-5xl`; the design guide (docs/DESIGN.md) owns the contract and
// the design-system gate keeps legacy Screen widths out of features.
export function Screen({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`p-4 md:p-8 ${className}`}>
      <div>{children}</div>
    </div>
  );
}
