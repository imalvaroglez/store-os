import { useState } from "react";
import { useStore } from "./StoreProvider";
import { useRoute } from "./router";
import {
  StoreSwitcher,
  BottomNav,
  Sidebar,
  Sheet,
  Button,
  IconButton,
  type Tab,
} from "../design-system";
import { HomeScreen } from "../features/home/HomeScreen";
import { CatalogScreen } from "../features/catalog/CatalogScreen";
import { OrdersScreen } from "../features/orders/OrdersScreen";
import { CustomersScreen } from "../features/customers/CustomersScreen";
import { InventoryScreen } from "../features/inventory/InventoryScreen";

const TAB_FOR_PATH: Record<string, Tab> = {
  "": "inicio",
  "catalogo-admin": "catalogo",
  pedidos: "pedidos",
  clientes: "clientes",
  inventario: "inventario",
};

export function AppShell() {
  const { activeStore, resetDemo } = useStore();
  const route = useRoute();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const seg = route.name === "admin" ? route.params.tab ?? "" : "";
  const tab: Tab = seg === "catalogo-admin" ? "catalogo" : TAB_FOR_PATH[seg] ?? "inicio";

  if (!activeStore) return null;

  let screen;
  switch (tab) {
    case "catalogo":
      screen = <CatalogScreen />;
      break;
    case "pedidos":
      screen = <OrdersScreen />;
      break;
    case "clientes":
      screen = <CustomersScreen />;
      break;
    case "inventario":
      screen = <InventoryScreen />;
      break;
    default:
      screen = <HomeScreen />;
  }

  return (
    <div className="md:flex md:h-full">
      {/* Desktop sidebar */}
      <Sidebar
        active={tab}
        storeType={activeStore.type}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Main column (mobile: header + scroll + bottom nav; desktop: scroll only) */}
      <div className="flex flex-col h-full min-w-0 flex-1">
        {/* Mobile-only top header */}
        <header
          className="md:hidden sticky top-0 z-20 bg-paper/90 backdrop-blur px-4 py-3 flex items-center justify-between border-b border-rule/60"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
        >
          <StoreSwitcher />
          <IconButton
            variant="ghost"
            onClick={() => setSettingsOpen(true)}
            aria-label="Opciones"
            className="text-xl"
          >
            ⚙️
          </IconButton>
        </header>

        <main className="flex-1 overflow-y-auto pb-24 md:pb-8">{screen}</main>

        {/* Mobile-only bottom nav */}
        <BottomNav active={tab} storeType={activeStore.type} />
      </div>

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Opciones">
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            Store OS guarda todo en este dispositivo. No se sincroniza con la nube (todavía).
          </p>
          <Button
            variant="danger"
            full
            onClick={() => {
              if (confirm("Esto borra todo y recarga los datos de ejemplo. ¿Continuar?")) {
                resetDemo();
                setSettingsOpen(false);
              }
            }}
          >
            Reiniciar con datos de ejemplo
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
