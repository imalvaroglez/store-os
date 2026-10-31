import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:brightness-95 active:brightness-90 shadow-sm",
  secondary:
    "bg-surface text-on-surface ring-1 ring-edge hover:bg-surface-muted active:bg-surface-muted",
  ghost: "bg-transparent text-ink-soft hover:bg-surface-muted active:bg-surface-muted",
  danger: "bg-[var(--danger)] text-on-accent hover:brightness-95 active:brightness-90 shadow-sm",
  success: "bg-[var(--success)] text-on-accent hover:brightness-95 active:brightness-90 shadow-sm",
};

// sm/md carry a min tap height (~40px) so dense tables stay touch-friendly.
const SIZES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm min-h-10",
  md: "px-4 py-2 text-sm min-h-10",
  lg: "px-5 py-3.5 text-base",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  full = false,
  className = "",
  children,
  ...rest
}: Props) {
  return (
    <button
      className={`rounded-xl font-semibold tracking-tight transition-all active:translate-y-px active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 disabled:active:translate-y-0 ${VARIANTS[variant]} ${SIZES[size]} ${full ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// Square icon-only button (inventory ±1, nav, close). Replaces raw icon buttons.
export function IconButton({
  variant = "secondary",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const styles: Record<string, string> = {
    primary: "bg-ink text-paper active:brightness-90",
    secondary: "bg-surface text-on-surface ring-1 ring-edge active:bg-surface-muted",
    ghost: "bg-transparent text-ink-soft active:bg-surface-muted",
  };
  return (
    <button
      className={`h-10 w-10 rounded-xl flex items-center justify-center text-xl font-bold transition-all active:scale-95 ${styles[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
