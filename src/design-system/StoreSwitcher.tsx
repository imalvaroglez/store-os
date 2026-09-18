import { useState } from "react";
import { STORE_TYPE_LABELS } from "../lib/labels";
import type { Store } from "../types";

// Presentational store picker for the admin rails. Data arrives via props:
// the design system never imports app state — that chain would drag the
// Firebase SDK into every barrel consumer, including the public storefront
// entry (see scripts/check-public-bundle.mjs).
export function StoreSwitcher({
  stores,
  activeStore,
  onSelect,
}: {
  stores: Store[];
  activeStore: Store;
  onSelect: (storeId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 bg-surface ring-1 ring-edge rounded-xl pl-3 pr-2 py-1.5 shadow-card"
      >
        <span className="h-7 w-7 rounded-lg bg-ink text-paper flex items-center justify-center serif-display text-sm font-semibold shrink-0">
          {activeStore.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="text-left">
          <span className="block text-sm font-bold text-ink leading-none">
            {activeStore.name}
          </span>
          <span className="block text-[10px] text-ink-soft/70 uppercase tracking-wide leading-tight mt-0.5">
            {STORE_TYPE_LABELS[activeStore.type]}
          </span>
        </span>
        <span className={`text-ink-soft/60 transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute z-30 mt-2 w-60 bg-surface text-on-surface rounded-2xl ring-1 ring-edge shadow-lift overflow-hidden p-1.5">
            {stores.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  onSelect(s.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 text-left px-2.5 py-2 rounded-xl transition-colors ${
                  s.id === activeStore.id ? "bg-paper-2" : "hover:bg-paper-2/60"
                }`}
              >
                <span className="h-8 w-8 rounded-lg bg-ink text-paper flex items-center justify-center serif-display text-sm font-semibold shrink-0">
                  {s.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">{s.name}</span>
                  <span className="block text-[10px] text-ink-soft/70 uppercase tracking-wide">
                    {STORE_TYPE_LABELS[s.type]}
                  </span>
                </span>
                {s.id === activeStore.id && (
                  <span className="ml-auto text-terracotta">●</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
