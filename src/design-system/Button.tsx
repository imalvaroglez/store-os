import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-stone-800 active:bg-stone-950 shadow-sm",
  secondary:
    "bg-white/70 text-ink ring-1 ring-rule hover:bg-white active:bg-paper-2",
  ghost: "bg-transparent text-ink-soft hover:bg-stone-200/50",
  danger: "bg-rose-600 text-white hover:bg-rose-500 active:bg-rose-700 shadow-sm",
  success: "bg-forest text-paper hover:bg-forest-700 active:bg-forest-700 shadow-sm",
};

const SIZES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
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
    primary: "bg-ink text-paper active:bg-stone-700",
    secondary: "bg-white/70 text-ink ring-1 ring-rule active:bg-paper-2",
    ghost: "bg-transparent text-ink-soft active:bg-stone-200/50",
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
