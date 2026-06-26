import { navigate, visibleNavItems, type Tab } from "./navItems";

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

  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-paper/95 backdrop-blur border-t border-rule/80 flex z-30 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {tabs.map((t) => {
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
