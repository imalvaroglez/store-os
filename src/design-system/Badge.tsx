import type { ReactNode } from "react";
import { TONE_BADGE, type StatusTone } from "./tokens";

// Status / pill badge. Replaces every inline `bg-*-100 text-*-700 rounded-full` chip.
export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${TONE_BADGE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
