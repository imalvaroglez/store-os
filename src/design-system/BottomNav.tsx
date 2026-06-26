import { navigate } from "../lib/router";
import type { StoreType } from "../types";

export type Tab = "inicio" | "catalogo" | "pedidos" | "clientes" | "inventario";

const TABS: { id: Tab; label: string; path: string }[] = [
  { id: "inicio", label: "Inicio", path: "/" },
  { id: "catalogo", label: "Catálogo", path: "/catalogo-admin" },
  { id: "pedidos", label: "Pedidos", path: "/pedidos" },
  { id: "clientes", label: "Clientes", path: "/clientes" },
  { id: "inventario", label: "Inventario", path: "/inventario" },
];

export function BottomNav({
  active,
  storeType,
}: {
  active: Tab;
  storeType: StoreType;
}) {
  const tabs = TABS.filter(
    (t) => t.id !== "inventario" || storeType === "inventory_tiered"
  );

  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-paper/95 backdrop-blur border-t border-rule/80 flex z-30"
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
