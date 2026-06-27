import type { ReactNode } from "react";

// Paper card: warm surface with a hairline edge and soft lift on the paper bg.
export function Card({
  children,
  className = "",
  onClick,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  interactive?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-surface text-on-surface rounded-card ring-1 ring-edge shadow-card p-4 ${
        interactive || onClick ? "cursor-pointer active:scale-[0.99] hover:shadow-lift transition-all" : "transition-shadow"
      } ${className}`}
    >
      {children}
    </div>
  );
}
