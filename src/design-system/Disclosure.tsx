import type { ReactNode } from "react";

/** Native disclosure for optional detail, with the same touch/spacing tokens. */
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-edge bg-surface p-3">
      <summary className="min-h-10 flex items-center justify-between gap-3 cursor-pointer text-base font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-terracotta">
        <span>{label}</span>
        <span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}
