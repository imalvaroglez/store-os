import { useEffect, useState, type ReactNode } from "react";
import { areaIdForTab, navigate, visibleNav, type PlatformRole, type Tab } from "./navItems";
import type { StoreType } from "../types";

// Desktop navigation: a fixed left rail. Mobile uses BottomNav instead.
// Terracotta active indicator is a left bar (mirrors the top bar in BottomNav).
// The store switcher arrives as a slot (switcher prop): the design system must
// not import app state — that chain would drag the Firebase SDK into every
// barrel consumer, including the public storefront entry.
//
// #454: four AREAS in a fixed contract order. An area is a pure container —
// its label expands/collapses, never navigates. On mount ONLY the area holding
// the active route is open (deep-links, refresh, back/forward all land with
// the right group open); the rest stay closed so the rail never turns endless.
export function Sidebar({
  active,
  storeType,
  userRole,
  switcher,
  onOpenSettings,
  onOpenStoreSettings,
  onChangeStore,
}: {
  active: Tab;
  storeType: StoreType;
  userRole?: PlatformRole;
  switcher?: ReactNode;
  onOpenSettings: () => void;
  onOpenStoreSettings?: () => void;
  onChangeStore?: () => void;
}) {
  const { flat, areas } = visibleNav(storeType, userRole);
  const activeArea = areaIdForTab(active);
  const [openAreas, setOpenAreas] = useState<Record<string, boolean>>(() =>
    activeArea ? { [activeArea]: true } : {}
  );
  const toggleArea = (id: string) => setOpenAreas((prev) => ({ ...prev, [id]: !prev[id] }));
  // #454 r2 (revisión): in-session navigation (palette, contextual links)
  // opens the destination area too — identical to a refresh/deep-link; the
  // groups the operator opened by hand stay open.
  useEffect(() => {
    if (activeArea) setOpenAreas((prev) => (prev[activeArea] ? prev : { ...prev, [activeArea]: true }));
  }, [activeArea]);

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-rule/70 bg-paper/60 backdrop-blur h-dvh overflow-y-auto sticky top-0">
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-2">
          <span className="h-8 w-8 rounded-lg bg-ink text-paper flex items-center justify-center serif-display font-semibold">
            S
          </span>
          <span className="serif-display text-lg font-semibold text-ink">Store OS</span>
        </div>
      </div>

      <div className="px-3 pb-2 space-y-1">
        {switcher}
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
        {flat
          .filter((f) => f.id !== "usuarios")
          .map((f) => (
            <button
              key={f.id}
              onClick={() => navigate(f.path)}
              aria-current={f.id === active ? "page" : undefined}
              className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-semibold transition-colors ${
                f.id === active
                  ? "bg-terracotta text-on-accent"
                  : "text-on-surface-soft hover:bg-surface-2 hover:text-on-surface"
              }`}
            >
              {f.label}
            </button>
          ))}
        {areas.map((area) => {
          const open = !!openAreas[area.id];
          const areaOn = area.id === activeArea;
          return (
            <div key={area.id} className="space-y-1">
              <button
                aria-expanded={open}
                onClick={() => toggleArea(area.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-sm font-semibold transition-colors ${
                  areaOn
                    ? "bg-terracotta text-on-accent"
                    : "text-on-surface-soft hover:bg-surface-2 hover:text-on-surface"
                }`}
              >
                {area.label}
                <span className={`inline-block transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
              </button>
              {open && (
                <div className="space-y-1 pl-3">
                  {area.children.map((leaf) => {
                    const leafOn = leaf.id === active;
                    return (
                      <button
                        key={leaf.id}
                        onClick={() => navigate(leaf.path)}
                        aria-current={leafOn ? "page" : undefined}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors border-l-2 ${
                          leafOn
                            ? "border-terracotta text-ink font-semibold bg-surface-2"
                            : "border-rule text-on-surface-soft hover:bg-surface-2 hover:text-on-surface"
                        }`}
                      >
                        {leaf.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-edge/60 space-y-1">
        {onOpenStoreSettings && (
          <button
            onClick={onOpenStoreSettings}
            className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-semibold transition-colors ${
              active === "tienda"
                ? "bg-terracotta text-on-accent"
                : "text-on-surface-soft hover:bg-surface-2 hover:text-on-surface"
            }`}
          >
            Tienda
          </button>
        )}
        {flat
          .filter((f) => f.id === "usuarios")
          .map((f) => (
            <button
              key={f.id}
              onClick={() => navigate(f.path)}
              aria-current={f.id === active ? "page" : undefined}
              className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-semibold transition-colors ${
                f.id === active
                  ? "bg-terracotta text-on-accent"
                  : "text-on-surface-soft hover:bg-surface-2 hover:text-on-surface"
              }`}
            >
              {f.label}
            </button>
          ))}
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
