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
  return (
    <StoreProvider>
      <div className="mx-auto max-w-md h-full min-h-full flex flex-col relative">
        {/* hairline frame edges so the mobile column reads as a page on paper */}
        <div className="absolute inset-y-0 left-0 w-px bg-rule/60 hidden sm:block" />
        <div className="absolute inset-y-0 right-0 w-px bg-rule/60 hidden sm:block" />
        <Root />
      </div>
    </StoreProvider>
  );
}
