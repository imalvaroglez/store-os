import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "./StoreProvider";
import { useAuth } from "./firebase/AuthProvider";
import { useRoute } from "./router";
import {
  BottomNav,
  StoreSwitcher,
  Sidebar,
  Sheet,
  Button,
  IconButton,
  ThemePicker,
  CommandPalette,
  EmptyState,
  Screen,
  ScreenHeader,
  type CommandGroup,
  type Tab,
} from "../design-system";
import { visibleNavItems, navigate } from "../design-system/navItems";
import { VersionFooter } from "./VersionFooter";
import { HomeScreen } from "../features/home/HomeScreen";
import { CatalogScreen } from "../features/catalog/CatalogScreen";
import { CategoriesScreen } from "../features/catalog/CategoriesScreen";
import { OrdersScreen } from "../features/orders/OrdersScreen";
import { OrderEditorScreen } from "../features/orders/OrderEditorScreen";
import { CustomersScreen } from "../features/customers/CustomersScreen";
import { PurchasesScreen } from "../features/inventory/PurchasesScreen";
import { ExpensesScreen } from "../features/expenses/ExpensesScreen";
import { PackagingScreen } from "../features/packaging/PackagingScreen";
import { PricingRulesScreen } from "../features/pricing/PricingRulesScreen";
import { PricingStrategyScreen } from "../features/pricing/PricingStrategyScreen";
import { StoreSettingsScreen } from "../features/stores/StoreSettingsScreen";
import { PlatformUsersScreen } from "../features/users/PlatformUsersScreen";

const TAB_FOR_PATH: Record<string, Tab> = {
  "": "inicio",
  productos: "productos",
  pedidos: "pedidos",
  clientes: "clientes",
  usuarios: "usuarios",
};

export function AppShell() {
  const { state, activeStore, setActiveStore } = useStore();
  const { user, enabled: authEnabled, signOut } = useAuth();
  const route = useRoute();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const mobileHeaderRef = useRef<HTMLElement>(null);
  const [cmdOpen, setCmdOpen] = useState(false);

  const seg = route.name === "admin" ? route.params.tab ?? "" : "";
  const sub = route.name === "admin" ? route.params.sub ?? "" : "";
  const storeSettingsRoute = seg === "tienda" && sub === "configuracion";
  // The productos parent renders the list by default and resolves to a child
  // tab when a sub-route is present (/productos/categorias). Legacy
  // /catalogo-admin and /inventario URLs never reach here (router redirects).
  let tab: Tab;
  if (storeSettingsRoute) {
    tab = "tienda";
  } else if (seg === "productos") {
    tab = sub === "categorias" ? "productos_categorias" : sub === "compras" ? "productos_compras" : sub === "gastos" ? "productos_gastos" : sub === "empaques" ? "productos_empaques" : sub === "reglas" ? "productos_reglas" : sub === "estrategia" ? "productos_estrategia" : "productos";
  } else {
    tab = TAB_FOR_PATH[seg] ?? "inicio";
  }

  // The document owns scrolling; a new route starts at its content heading.
  useEffect(() => {
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  }, [seg, sub, activeStore?.id]);

  // Sticky content follows the actual mobile header height, including safe area
  // and larger theme fonts; no second scroll region or guessed pixel offset.
  useLayoutEffect(() => {
    const header = mobileHeaderRef.current;
    if (!header) return;
    const measure = () => header.parentElement?.style.setProperty("--admin-header-height", `${header.getBoundingClientRect().height}px`);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [activeStore?.id, tab, user?.role]);

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

  const canManageStore = user?.role === "super_admin" || activeStore.ownerUid === user?.uid;

  if (storeSettingsRoute && !canManageStore) {
    return (
      <Screen>
        <EmptyState
          title="No tienes permiso"
          subtitle="Solo la persona dueña o la administración pueden administrar esta tienda."
          action={<Button variant="secondary" onClick={() => navigate("/")}>Volver al inicio</Button>}
        />
      </Screen>
    );
  }

  if (tab === "usuarios" && user?.role !== "super_admin") {
    return (
      <Screen>
        <EmptyState
          title="No tienes permiso"
          subtitle="Solo la administración de la plataforma puede consultar esta lista."
          action={<Button variant="secondary" onClick={() => navigate("/")}>Volver al inicio</Button>}
        />
      </Screen>
    );
  }

  const commands: CommandGroup[] = [
    {
      group: "Ir a",
      items: visibleNavItems(activeStore.type, user?.role).map((t) => ({
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
    case "productos_gastos":
      screen = <ExpensesScreen />;
      break;
    case "productos_empaques":
      // key: switching stores must never carry one store's draft into another.
      screen = <PackagingScreen key={activeStore?.id ?? "store"} />;
      break;
    case "productos_reglas":
      screen = <PricingRulesScreen key={activeStore?.id ?? "store"} />;
      break;
    case "productos_estrategia":
      // key: switching stores must never carry one store's draft into another.
      screen = <PricingStrategyScreen key={activeStore?.id ?? "store"} />;
      break;
    case "pedidos":
      // key={sub}: back/forward between two editors must remount the form, or
      // the frozen useState draft of order A would edit/save over order B.
      screen = sub ? <OrderEditorScreen key={sub} /> : <OrdersScreen />;
      break;
    case "clientes":
      screen = <CustomersScreen />;
      break;
    case "usuarios":
      screen = <PlatformUsersScreen userRole={user?.role} />;
      break;
    case "tienda":
      screen = (
        <Screen>
          <ScreenHeader
            title="Administrar tienda"
            subtitle={activeStore.name}
            action={<Button variant="ghost" onClick={() => navigate("/")}>← Inicio</Button>}
          />
          <div className="mx-auto max-w-5xl">
            <StoreSettingsScreen storeId={activeStore.id} onDeleted={() => navigate("/")} />
          </div>
        </Screen>
      );
      break;
    default:
      screen = <HomeScreen />;
  }

  return (
    <div className="md:flex min-h-dvh">
      {/* Desktop sidebar */}
      <Sidebar
        active={tab}
        storeType={activeStore.type}
        userRole={user?.role}
        switcher={<StoreSwitcher stores={state.stores} activeStore={activeStore} onSelect={setActiveStore} />}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenStoreSettings={canManageStore ? () => navigate("/tienda/configuracion") : undefined}
        onChangeStore={user ? () => setActiveStore(null) : undefined}
      />

      {/* Main column (mobile: header + scroll + bottom nav; desktop: scroll only) */}
      <div className="flex flex-col min-h-dvh min-w-0 flex-1">
        {/* Mobile-only top header */}
        <header
          ref={mobileHeaderRef}
          className="md:hidden sticky top-0 z-20 bg-paper/90 backdrop-blur px-4 py-3 flex items-center justify-between border-b border-rule/60"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
        >
          <StoreSwitcher stores={state.stores} activeStore={activeStore} onSelect={setActiveStore} />
          <div className="flex items-center gap-2">
            {canManageStore && (
              <Button variant="ghost" size="sm" onClick={() => navigate("/tienda/configuracion")}>
                Tienda
              </Button>
            )}
            <IconButton
              variant="ghost"
              onClick={() => setSettingsOpen(true)}
              aria-label="Opciones"
              className="text-xl"
            >
              ⚙️
            </IconButton>
          </div>
        </header>

        <main className="flex-1 min-w-0 pb-8">{screen}</main>

        {/* Version + release notes at the panel footer (#179) */}
        <VersionFooter />

        {/* Mobile-only bottom nav */}
        <BottomNav active={tab} storeType={activeStore.type} userRole={user?.role} />
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

        </div>
      </Sheet>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} commands={commands} />
    </div>
  );
}
