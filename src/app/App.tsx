import { lazy, Suspense } from "react";
import { useStore } from "./StoreProvider";
import { useAuth } from "./firebase/AuthProvider";
import { useRoute } from "./router";
import { AppShell } from "./AppShell";
import { AuthScreen } from "./firebase/AuthScreen";
import { StoresScreen } from "../features/stores/StoresScreen";
import { StorePickerScreen } from "../features/stores/StorePickerScreen";
import { ToastProvider } from "../design-system";

// Lazy-load the public storefront so the storefront code (sections, gallery,
// SEO) lives in its own chunk, separate from admin forms.
// ponytail: the entry chunk still bundles Firebase because StoreProvider/
// AuthProvider mount unconditionally at the root (main.tsx). Fully excluding
// Firebase from the public path would mean route-detecting before the provider
// tree mounts — a bigger refactor deferred until the public bundle size
// measurably hurts the anonymous visitor.
const OliviaStorefront = lazy(() =>
  import("../features/catalog/OliviaStorefront").then((m) => ({ default: m.OliviaStorefront }))
);

function Root() {
  const route = useRoute();
  const { activeStore, state } = useStore();
  const { user } = useAuth();

  // Public storefront routes take over the whole viewport: no shell, no private
  // data. Anonymous-readable. A single component handles all three sub-routes.
  if (
    route.name === "public_store" ||
    route.name === "public_category" ||
    route.name === "public_product"
  ) {
    return (
      <Suspense fallback={<div className="min-h-full" role="status" aria-label="Cargando…" />}>
        <OliviaStorefront route={route} />
      </Suspense>
    );
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
  // StoreProvider lives at the root (main.tsx) alongside Auth/Theme so the whole
  // tree shares one store instance. App owns the toast layer, which scopes it to
  // authenticated shell + catalog screens (not the bare error boundary).
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}
