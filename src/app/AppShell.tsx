import { useEffect, useState } from "react";
import { useStore } from "./StoreProvider";
import { useAuth } from "./firebase/AuthProvider";
import { AuthScreen } from "./firebase/AuthScreen";
import { useRoute } from "./router";
import {
  StoreSwitcher,
  BottomNav,
  Sidebar,
  Sheet,
  Button,
  IconButton,
  ThemePicker,
  CommandPalette,
  type CommandGroup,
  type Tab,
} from "../design-system";
import { visibleNavItems, navigate } from "../design-system/navItems";
import { HomeScreen } from "../features/home/HomeScreen";
import { CatalogScreen } from "../features/catalog/CatalogScreen";
import { CategoriesScreen } from "../features/catalog/CategoriesScreen";
import { OrdersScreen } from "../features/orders/OrdersScreen";
import { CustomersScreen } from "../features/customers/CustomersScreen";
import { PurchasesScreen } from "../features/inventory/PurchasesScreen";

const TAB_FOR_PATH: Record<string, Tab> = {
  "": "inicio",
  productos: "productos",
  pedidos: "pedidos",
  clientes: "clientes",
};

export function AppShell() {
  const { activeStore, setActiveStore } = useStore();
  const { user, enabled: authEnabled, signOut } = useAuth();
  const route = useRoute();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  const seg = route.name === "admin" ? route.params.tab ?? "" : "";
  const sub = route.name === "admin" ? route.params.sub ?? "" : "";
  // The productos parent renders the list by default and resolves to a child
  // tab when a sub-route is present (/productos/categorias). Legacy
  // /catalogo-admin and /inventario URLs never reach here (router redirects).
  let tab: Tab;
  if (seg === "productos") {
    tab = sub === "categorias" ? "productos_categorias" : sub === "compras" ? "productos_compras" : "productos";
  } else {
    tab = TAB_FOR_PATH[seg] ?? "inicio";
  }

  // Cmd/Ctrl+K opens the command palette. Global while the shell is mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!activeStore) return null;

  const commands: CommandGroup[] = [
    {
      group: "Ir a",
      items: visibleNavItems(activeStore.type).map((t) => ({
        id: t.id,
        label: t.label,
        onSelect: () => navigate(t.path),
      })),
    },
  ];

  let screen;
  switch (tab) {
    case "productos":
      screen = <CatalogScreen />;
      break;
    case "productos_categorias":
      screen = <CategoriesScreen />;
      break;
    case "productos_compras":
      screen = <PurchasesScreen />;
      break;
    case "pedidos":
      screen = <OrdersScreen />;
      break;
    case "clientes":
      screen = <CustomersScreen />;
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
        onChangeStore={user ? () => setActiveStore(null) : undefined}
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
        <div className="space-y-5">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Tema</h3>
            <ThemePicker />
          </div>

          {authEnabled && user && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Cuenta</h3>
              <p className="text-sm text-ink-soft">
                Conectado como <span className="font-semibold text-ink">{user.email}</span>
                {user.role === "super_admin" && " · administrador"}
              </p>
              <p className="text-xs text-ink-soft">Tus tiendas se sincronizan en la nube.</p>
              <Button
                variant="secondary"
                full
                onClick={() => {
                  signOut();
                  setSettingsOpen(false);
                }}
              >
                Cerrar sesión
              </Button>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Datos</h3>
            <p className="text-sm text-ink-soft">Tus datos viven en la nube y se sincronizan entre dispositivos.</p>
          </div>
        </div>
      </Sheet>

      <Sheet open={authOpen} onClose={() => setAuthOpen(false)} title="Cuenta">
        <AuthScreen onDone={() => setAuthOpen(false)} />
      </Sheet>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} commands={commands} />
    </div>
  );
}
