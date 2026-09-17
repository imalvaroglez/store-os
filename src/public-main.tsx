import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { useRoute } from "./app/router";
import { OLIVIA_SLUG } from "./design-system/olivia";
import "./public.css";

// Public storefront entry: the anonymous visitor at /catalogo/:slug gets
// react + the storefront + the anonymous REST catalog — never the admin
// shell, Firebase Auth/StoreProvider, or the service worker. Admin routes
// that somehow land here hand off to the admin entry (index.html).
const OliviaStorefront = lazy(() =>
  import("./features/catalog/OliviaStorefront").then((m) => ({ default: m.OliviaStorefront }))
);
const PublicCatalogScreen = lazy(() =>
  import("./features/catalog/PublicCatalogScreen").then((m) => ({ default: m.PublicCatalogScreen }))
);

function PublicRoot() {
  const route = useRoute();
  const isPublic =
    route.name === "public_store" || route.name === "public_category" || route.name === "public_product";

  if (!isPublic) {
    window.location.replace("/");
    return null;
  }

  const slug = "slug" in route.params ? route.params.slug : "";
  return (
    <Suspense fallback={<div className="min-h-full" role="status" aria-label="Cargando…" />}>
      {slug === OLIVIA_SLUG ? <OliviaStorefront route={route} /> : <PublicCatalogScreen slug={slug} />}
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <PublicRoot />
    </ErrorBoundary>
  </StrictMode>
);
