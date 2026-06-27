import type { ReactNode } from "react";

// Serif display title over a grotesk subtitle — editorial hierarchy.
export function ScreenHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-end justify-between gap-3">
        <h1 className="serif-display text-[1.7rem] leading-none font-semibold text-ink tracking-tight">
          {title}
        </h1>
        {action && <div className="shrink-0 pb-0.5">{action}</div>}
      </div>
      {subtitle && <p className="text-sm text-ink-soft mt-1.5">{subtitle}</p>}
      <div className="rule mt-3" />
    </div>
  );
}
