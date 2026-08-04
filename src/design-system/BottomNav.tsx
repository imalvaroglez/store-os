import { useEffect, useRef, useState } from "react";
import { navigate, visibleNavItems, parentActive, type Tab } from "./navItems";

// Re-export so existing imports (`import { BottomNav, type Tab }`) keep working.
export type { Tab };

export function BottomNav({
  active,
  storeType,
}: {
  active: Tab;
  storeType: import("../types").StoreType;
}) {
  const tabs = visibleNavItems(storeType);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Close the upward panel on outside-click or Esc.
  useEffect(() => {
    if (!catalogOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setCatalogOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCatalogOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [catalogOpen]);

  // Close when navigating away from the catalog group.
  useEffect(() => {
    if (!parentActive(active)) setCatalogOpen(false);
  }, [active]);

  return (
    <nav
      ref={navRef}
      className="fixed bottom-0 inset-x-0 bg-paper/95 backdrop-blur border-t border-rule/80 flex z-30 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((t) => {
        // Catalog parent: toggles an upward panel, does not navigate itself.
        if (t.children) {
          const parentOn = parentActive(active) || catalogOpen;
          return (
            <button
              key={t.id}
              aria-expanded={catalogOpen}
              aria-haspopup="menu"
              onClick={() => setCatalogOpen((v) => !v)}
              className={`relative flex-1 py-3 text-[13px] font-semibold transition-colors ${
                parentOn ? "text-ink" : "text-ink-soft/50"
              }`}
            >
              <span className="block">
                {t.label} <span className={`inline-block transition-transform ${catalogOpen ? "rotate-180" : ""}`}>▾</span>
              </span>
              {parentActive(active) && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-8 rounded-full bg-terracotta" />
              )}
              {catalogOpen && (
                <div
                  role="menu"
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 rounded-lg bg-paper border border-rule shadow-lift py-1"
                  style={{ animation: "dropdownIn var(--motion-fast) var(--ease-smooth)" }}
                >
                  {t.children.map((c) => {
                    const childOn = c.id === active;
                    return (
                      <button
                        key={c.id}
                        role="menuitem"
                        onClick={() => {
                          navigate(c.path);
                          setCatalogOpen(false);
                        }}
                        className={`block w-full text-center px-4 py-2 text-sm ${
                          childOn ? "text-terracotta font-semibold" : "text-ink"
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </button>
          );
        }
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            onClick={() => navigate(t.path)}
            className={`relative flex-1 py-3 text-[13px] font-semibold transition-colors ${
              isActive ? "text-ink" : "text-ink-soft/50"
            }`}
          >
            <span className="block">{t.label}</span>
            {isActive && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-8 rounded-full bg-terracotta" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
