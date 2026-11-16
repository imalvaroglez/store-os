import { useEffect, useRef, useState } from "react";
import { areaIdForTab, navigate, visibleNav, type PlatformRole, type Tab } from "./navItems";

// Re-export so existing imports (`import { BottomNav, type Tab }`) keep working.
export type { Tab };

// #454: mobile bottom bar — Inicio plus the four AREAS. Each area opens an
// upward menu with its leaves (the area itself never navigates). A leaf is
// reachable in ≤2 interactions: tap the area, tap the destination.
export function BottomNav({
  active,
  storeType,
  userRole,
}: {
  active: Tab;
  storeType: import("../types").StoreType;
  userRole?: PlatformRole;
}) {
  const { flat, areas } = visibleNav(storeType, userRole);
  const [openArea, setOpenArea] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Close the upward panel on outside-click or Esc.
  useEffect(() => {
    if (!openArea) return;
    const onDoc = (e: MouseEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpenArea(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenArea(null);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [openArea]);

  // Close ONLY on an actual route change out of the open area — not when the
  // menu itself opens while a flat tab (e.g. Inicio) is active.
  const prevActive = useRef(active);
  useEffect(() => {
    if (prevActive.current === active) return;
    prevActive.current = active;
    if (openArea && areaIdForTab(active) !== openArea) setOpenArea(null);
  }, [active, openArea]);


  return (
    <nav
      ref={navRef}
      className="fixed bottom-0 inset-x-0 bg-paper/95 backdrop-blur border-t border-rule/80 flex z-30 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {flat.map((f) => {
        const isActive = f.id === active;
        return (
          <button
            key={f.id}
            onClick={() => navigate(f.path)}
            aria-current={isActive ? "page" : undefined}
            className={`relative flex-1 py-3 text-[13px] font-semibold transition-colors ${
              isActive ? "text-ink" : "text-ink-soft/50"
            }`}
          >
            <span className="block">{f.label}</span>
            {isActive && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-8 rounded-full bg-terracotta" />
            )}
          </button>
        );
      })}
      {areas.map((area) => {
        const areaOn = area.id === areaIdForTab(active);
        const menuOpen = openArea === area.id;
        return (
          <div
            key={area.id}
            className={`relative flex-1 text-[13px] font-semibold transition-colors flex items-center justify-center ${
              areaOn || menuOpen ? "text-ink" : "text-ink-soft/50"
            }`}
          >
            <button
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={area.label}
              onClick={() => setOpenArea((v) => (v === area.id ? null : area.id))}
              className="w-full py-3"
            >
              {area.label}
            </button>
            {areaOn && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-8 rounded-full bg-terracotta" />
            )}
          </div>
        );
      })}
      {/* #454 r2: the open area's menu anchors to the NAV itself (a bottom
          sheet above the bar), never to its tab — an edge tab's centered
          w-44 flyout clipped 41px off-viewport at 390px. Full-width keeps
          every leaf tappable at any viewport. */}
      {openArea && (
        <div
          role="menu"
          className="absolute bottom-full inset-x-2 mb-2 rounded-lg bg-paper border border-rule shadow-lift py-1"
          style={{ animation: "dropdownIn var(--motion-fast) var(--ease-smooth)" }}
        >
          {(areas.find((area) => area.id === openArea)?.children ?? []).map((leaf) => {
            const childOn = leaf.id === active;
            return (
              <button
                key={leaf.id}
                role="menuitem"
                onClick={() => {
                  navigate(leaf.path);
                  setOpenArea(null);
                }}
                className={`block w-full text-center px-4 py-2 text-sm ${
                  childOn ? "text-terracotta font-semibold" : "text-ink"
                }`}
              >
                {leaf.label}
              </button>
            );
          })}
        </div>
      )}
    </nav>
  );
}
