import { useState } from "react";
import { navigate, visibleNavItems, parentActive, type Tab } from "./navItems";
import { StoreSwitcher } from "./StoreSwitcher";
import type { StoreType } from "../types";

// Desktop navigation: a fixed left rail. Mobile uses BottomNav instead.
// Terracotta active indicator is a left bar (mirrors the top bar in BottomNav).
export function Sidebar({
  active,
  storeType,
  onOpenSettings,
  onChangeStore,
}: {
  active: Tab;
  storeType: StoreType;
  onOpenSettings: () => void;
  onChangeStore?: () => void;
}) {
  const tabs = visibleNavItems(storeType);
  // Catalog parent expands inline. Open by default when a catalog child is active
  // so deep-linking to /catalogo-admin/categorias shows the open group.
  const [catalogOpen, setCatalogOpen] = useState<boolean>(() => parentActive(active));
  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-rule/70 bg-paper/60 backdrop-blur h-full sticky top-0">
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-2">
          <span className="h-8 w-8 rounded-lg bg-ink text-paper flex items-center justify-center serif-display font-semibold">
            S
          </span>
          <span className="serif-display text-lg font-semibold text-ink">Store OS</span>
        </div>
      </div>

      <div className="px-3 pb-2 space-y-1">
        <StoreSwitcher />
        {onChangeStore && (
          <button
            onClick={onChangeStore}
            className="w-full text-left px-3 py-2 rounded-md text-xs font-semibold text-ink-soft hover:bg-surface-2 hover:text-on-surface transition-colors"
          >
            ← Cambiar tienda
          </button>
        )}
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {tabs.map((t) => {
          // Catalog parent: toggles expansion, does not navigate by itself.
          if (t.children) {
            return (
              <div key={t.id} className="space-y-1">
                <button
                  aria-expanded={catalogOpen}
                  onClick={() => setCatalogOpen((v) => !v)}
                  className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-semibold transition-colors flex items-center justify-between ${
                    parentActive(active)
                      ? "bg-terracotta text-on-accent"
                      : "text-on-surface-soft hover:bg-surface-2 hover:text-on-surface"
                  }`}
                >
                  <span>{t.label}</span>
                  <span className={`transition-transform ${catalogOpen ? "rotate-180" : ""}`}>▾</span>
                </button>
                {catalogOpen && (
                  <div className="space-y-1 pl-3">
                    {t.children.map((c) => {
                      const childOn = c.id === active;
                      return (
                        <button
                          key={c.id}
                          onClick={() => navigate(c.path)}
                          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors border-l-2 ${
                            childOn
                              ? "border-terracotta text-ink font-semibold bg-surface-2"
                              : "border-rule text-on-surface-soft hover:bg-surface-2 hover:text-on-surface"
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
              onClick={() => navigate(t.path)}
              className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-semibold transition-colors ${
                isActive
                  ? "bg-terracotta text-on-accent"
                  : "text-on-surface-soft hover:bg-surface-2 hover:text-on-surface"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-edge/60">
        <button
          onClick={onOpenSettings}
          className="w-full text-left px-3 py-2.5 rounded-md text-sm font-semibold text-on-surface-soft hover:bg-surface-2 hover:text-on-surface transition-colors"
        >
          ⚙️ Opciones
        </button>
      </div>
    </aside>
  );
}
