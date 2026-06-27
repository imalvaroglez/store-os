import { useState } from "react";
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
  const { activeStore, resetDemo, cloud } = useStore();
  const { user, enabled: authEnabled, signOut } = useAuth();
  const route = useRoute();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

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
        <div className="space-y-5">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Tema</h3>
            <ThemePicker />
          </div>

          {authEnabled && (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Cuenta</h3>
              {user ? (
                <>
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
                </>
              ) : (
                <>
                  <p className="text-sm text-ink-soft">
                    Estás en modo demostración (local). Entra para sincronizar tus tiendas en la nube.
                  </p>
                  <Button
                    full
                    onClick={() => {
                      setSettingsOpen(false);
                      setAuthOpen(true);
                    }}
                  >
                    Entrar / Crear cuenta
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Datos</h3>
            {cloud ? (
              <p className="text-sm text-ink-soft">Tus datos viven en la nube y se sincronizan entre dispositivos.</p>
            ) : (
              <>
                <p className="text-sm text-ink-soft">
                  Store OS guarda todo en este dispositivo. {authEnabled ? "Entra para usar la nube." : "No se sincroniza con la nube."}
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
              </>
            )}
          </div>
        </div>
      </Sheet>

      <Sheet open={authOpen} onClose={() => setAuthOpen(false)} title="Cuenta">
        <AuthScreen onDone={() => setAuthOpen(false)} />
      </Sheet>
    </div>
  );
}
