import { StoreProvider, useStore } from "./StoreProvider";
import { useRoute } from "./router";
import { AppShell } from "./AppShell";
import { PublicCatalogScreen } from "../features/catalog/PublicCatalogScreen";
import { StoresScreen } from "../features/stores/StoresScreen";

function Root() {
  const route = useRoute();
  const { activeStore } = useStore();

  // Public catalog takes over the whole viewport, no shell, no private data.
  if (route.name === "public_catalog") {
    return <PublicCatalogScreen slug={route.params.slug} />;
  }

  // No store yet -> first-run creation screen.
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
