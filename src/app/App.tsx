import { StoreProvider, useStore } from "./StoreProvider";
import { useAuth } from "./firebase/AuthProvider";
import { useRoute } from "./router";
import { AppShell } from "./AppShell";
import { AuthScreen } from "./firebase/AuthScreen";
import { PublicCatalogScreen } from "../features/catalog/PublicCatalogScreen";
import { StoresScreen } from "../features/stores/StoresScreen";
import { StorePickerScreen } from "../features/stores/StorePickerScreen";

function Root() {
  const route = useRoute();
  const { activeStore, state } = useStore();
  const { user } = useAuth();

  // Public catalog takes over the whole viewport, no shell, no private data.
  if (route.name === "public_catalog") {
    return <PublicCatalogScreen slug={route.params.slug} />;
  }

  // Signed in but no active store yet -> the picker (or create-first if empty).
  if (user && !activeStore) {
    return state.stores.length > 0 ? <StorePickerScreen /> : (
      <div className="min-h-full">
        <StoresScreen />
      </div>
    );
  }

  // Signed out with no active store. In a built deployment (DEV=false) a visitor
  // must authenticate before anything else — no demo on the public app. In dev and
  // tests (DEV=true) keep the local create-first demo screen.
  if (!activeStore) {
    if (!import.meta.env.DEV) {
      return (
        <div className="min-h-full flex items-center justify-center p-4">
          <div className="w-full max-w-sm">
            <AuthScreen />
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-full">
        <StoresScreen />
      </div>
    );
  }

  return <AppShell />;
}

export function App() {
  // The shell owns width/responsiveness now (sidebar on desktop, column on mobile).
  return (
    <StoreProvider>
      <Root />
    </StoreProvider>
  );
}
