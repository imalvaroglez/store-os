import type { ReactNode } from "react";

// Screen content wrapper. Replaces the bare `<div className="p-4">` every screen
// used, so padding is consistent and responsive. On desktop, content is centered
// in a comfortable reading width unless `wide` is set (catalog/order grids).
export function Screen({
  children,
  wide = false,
  className = "",
}: {
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div className={`p-4 md:p-8 ${className}`}>
      <div className={wide ? "mx-auto max-w-6xl" : "mx-auto max-w-3xl"}>{children}</div>
    </div>
  );
}
