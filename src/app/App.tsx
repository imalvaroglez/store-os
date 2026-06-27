import { StoreProvider, useStore } from "./StoreProvider";
import { useAuth } from "./firebase/AuthProvider";
import { useRoute } from "./router";
import { AppShell } from "./AppShell";
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

  // Signed out (local demo) with no active store -> local create-first screen.
  if (!activeStore) {
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
