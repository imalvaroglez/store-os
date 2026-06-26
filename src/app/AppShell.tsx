import { useState } from "react";
import { useStore } from "./StoreProvider";
import { useRoute } from "./router";
import {
  StoreSwitcher,
  BottomNav,
  type Tab,
  Sheet,
  Button,
  IconButton,
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

  // admin tab from the route's first segment
  const seg = route.name === "admin" ? route.params.tab ?? "" : "";
  const tab: Tab =
    seg === "catalogo-admin"
      ? "catalogo"
      : TAB_FOR_PATH[seg] ?? "inicio";

  // Safety: if no active store, the no-store screen is rendered by App.tsx.
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
    <div className="flex flex-col h-full">
      <header
        className="sticky top-0 z-20 bg-paper/90 backdrop-blur px-4 py-3 flex items-center justify-between border-b border-rule/60"
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

      <main className="flex-1 overflow-y-auto pb-20">{screen}</main>

      <BottomNav active={tab} storeType={activeStore.type} />

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Opciones">
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Store OS guarda todo en este dispositivo. No se sincroniza con la nube (todavía).
          </p>
          <Button
            variant="danger"
            full
            onClick={() => {
              if (
                confirm(
                  "Esto borra todo y recarga los datos de ejemplo. ¿Continuar?"
                )
              ) {
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
