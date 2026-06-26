import type { ReactNode } from "react";

export function EmptyState({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {icon && <div className="mb-4 opacity-70">{icon}</div>}
      <h2 className="serif-display text-2xl font-semibold text-ink">{title}</h2>
      {subtitle && <p className="mt-2 text-ink-soft max-w-xs leading-relaxed">{subtitle}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
