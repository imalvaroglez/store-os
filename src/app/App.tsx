import { lazy, Suspense } from "react";
import { useStore } from "./StoreProvider";
import { useAuth } from "./firebase/AuthProvider";
import { useRoute } from "./router";
import { AppShell } from "./AppShell";
import { AuthScreen } from "./firebase/AuthScreen";
import { StoresScreen } from "../features/stores/StoresScreen";
import { StorePickerScreen } from "../features/stores/StorePickerScreen";
import { ToastProvider, OLIVIA_SLUG, useToast } from "../design-system";
import type { Storefront } from "../types";
import { canEditOliviaStorefront } from "./storefrontAccess";

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
const PublicCatalogScreen = lazy(() =>
  import("../features/catalog/PublicCatalogScreen").then((m) => ({ default: m.PublicCatalogScreen }))
);

function Root() {
  const route = useRoute();
  const { activeStore, state, saveStorefront } = useStore();
  const { user, authReady } = useAuth();
  const toast = useToast();
  const candidateStore = state.stores.find((store) => store.slug === OLIVIA_SLUG);
  const storefrontOwner = canEditOliviaStorefront(route, user, candidateStore) ? candidateStore : undefined;
  const storefrontEditor = storefrontOwner ? {
    storeId: storefrontOwner.id,
    storefront: storefrontOwner.storefront ?? {},
    save: (storeId: string, storefront: Storefront) => saveStorefront(storeId, storefront),
    notifySuccess: toast.success,
    notifyError: toast.error,
  } : undefined;

  // The owner editor uses the authenticated app entry so the anonymous
  // storefront bundle never contains Auth or private store data.
  if (route.name === "storefront_editor") {
    if (!authReady) return <div className="min-h-full" role="status" aria-label="Cargando sesión…" />;
    if (!user) return <AuthScreen />;
    if (!storefrontOwner || !storefrontEditor) {
      return <div className="min-h-full flex items-center justify-center p-6"><div className="space-y-3 text-center"><h1 className="text-lg font-semibold text-on-surface">No tienes acceso a este editor</h1><a className="text-primary underline" href="/catalogo/olivia">Volver al catálogo público</a></div></div>;
    }
    return <Suspense fallback={<div className="min-h-full" role="status" aria-label="Cargando…" />}><OliviaStorefront route={{ name: "storefront_editor", params: { slug: OLIVIA_SLUG } }} editor={storefrontEditor} /></Suspense>;
  }

  // Public storefront routes take over the whole viewport: no shell, no private
  // data. Anonymous-readable. A single component handles all three sub-routes.
  // These are the ONLY routes visible without authentication.
  if (
    route.name === "public_store" ||
    route.name === "public_category" ||
    route.name === "public_product"
  ) {
    const slug = route.params.slug;
    return (
      <Suspense fallback={<div className="min-h-full" role="status" aria-label="Cargando…" />}>
        {slug === OLIVIA_SLUG ? <OliviaStorefront route={route} editor={storefrontEditor} /> : <PublicCatalogScreen slug={slug} />}
      </Suspense>
    );
  }

  // SECURITY GATE: every non-public route requires an authenticated user. There
  // is NO local demo and NO anonymous access to the admin panel — a visitor who
  // lands on the root URL (or any private route) without a session sees ONLY the
  // authentication screen. This also closes the hole where a stale demo
  // activeStore in localStorage could render AppShell without a login.
  if (!user) {
    return (
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <AuthScreen />
        </div>
      </div>
    );
  }

  // Authenticated but no active store yet → the picker (or create-first if the
  // account is genuinely empty). super_admin sees every store here; a member
  // sees only the stores they belong to (scoped by loadCloudState + Firestore rules).
  if (!activeStore) {
    return state.stores.length > 0 ? <StorePickerScreen /> : (
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
      {/* Build marker for the refresh-hard-reload previewCheck/repro: visible text
          carrying the served deploy's SHA. Reads the same meta the Vite plugin injects. */}
      <BuildMarker />
    </ToastProvider>
  );
}

// ponytail: reads the x-build meta at runtime instead of duplicating the SHA at
// build time in a second channel — one source of truth, both HTML and DOM agree.
function BuildMarker() {
  const sha = document.querySelector('meta[name="x-build"]')?.getAttribute("content") ?? "dev";
  return (
    <div data-build-marker={sha} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" }}>
      {sha}
    </div>
  );
}
