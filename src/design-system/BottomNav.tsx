import { useEffect, useRef, useState } from "react";
import { navigate, visibleNavItems, parentActive, type PlatformRole, type Tab } from "./navItems";

// Re-export so existing imports (`import { BottomNav, type Tab }`) keep working.
export type { Tab };

export function BottomNav({
  active,
  storeType,
  userRole,
}: {
  active: Tab;
  storeType: import("../types").StoreType;
  userRole?: PlatformRole;
}) {
  const tabs = visibleNavItems(storeType, userRole);
  const [productosOpen, setProductosOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Close the upward panel on outside-click or Esc.
  useEffect(() => {
    if (!productosOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setProductosOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setProductosOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [productosOpen]);

  // Close when navigating away from the productos group.
  useEffect(() => {
    if (!parentActive(active)) setProductosOpen(false);
  }, [active]);

  return (
    <nav
      ref={navRef}
      className="fixed bottom-0 inset-x-0 bg-paper/95 backdrop-blur border-t border-rule/80 flex z-30 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((t) => {
        // Productos parent: the label navigates to the parent route; the
        // chevron is a separate control toggling the upward children panel.
        if (t.children) {
          const parentOn = parentActive(active) || productosOpen;
          return (
            <div
              key={t.id}
              className={`relative flex-1 py-3 text-[13px] font-semibold transition-colors flex items-stretch justify-center ${
                parentOn ? "text-ink" : "text-ink-soft/50"
              }`}
            >
              <button onClick={() => navigate(t.path)} className="px-1">
                {t.label}
              </button>
              <button
                aria-expanded={productosOpen}
                aria-haspopup="menu"
                aria-label="Expandir"
                onClick={() => setProductosOpen((v) => !v)}
                // #325: the glyph is ~14×20px — a thumb needs ≥40px. The hit
                // area grows via an invisible pseudo-element ANCHORED TO THE
                // TAB'S RIGHT EDGE: with 4-5 tabs at 390px a centered 44px box
                // overlaps the neighboring tab ("Pedidos" swallowed its right
                // side, 33px effective). Right-anchored, the full 44×44 lives
                // INSIDE this tab (label + chevron ≥ 74px wide) — the visual
                // density never changes and no neighbor is touched.
                className="relative px-1 after:absolute after:right-0 after:top-1/2 after:h-11 after:w-11 after:-translate-y-1/2 after:content-['']"
              >
                <span className={`inline-block transition-transform ${productosOpen ? "rotate-180" : ""}`}>▾</span>
              </button>
              {parentActive(active) && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-8 rounded-full bg-terracotta" />
              )}
              {productosOpen && (
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
                          setProductosOpen(false);
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
            </div>
          );
        }
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            aria-label={t.id === "usuarios" ? "Usuarios" : undefined}
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
