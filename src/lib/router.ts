// Tiny route matching. A route is "/catalogo/:slug" -> compiled into a regex.
// ponytail: hand-rolled, no dependency. Covers admin (hash-less) + public catalog.

export type RouteName = "public_store" | "public_category" | "public_product" | "admin";

export type RouteMatch =
  | { name: "public_store"; params: { slug: string } }
  | { name: "public_category"; params: { slug: string; categorySlug: string } }
  | { name: "public_product"; params: { slug: string; productSlug: string } }
  | { name: "admin"; params: { tab?: string; sub?: string } };

// Match a pathname against the public storefront routes, then the admin shell.
export function matchRoute(pathname: string): RouteMatch {
  const productMatch = pathname.match(/^\/catalogo\/([^/]+)\/producto\/([^/]+)\/?$/);
  if (productMatch) {
    return {
      name: "public_product",
      params: { slug: decodeURIComponent(productMatch[1]), productSlug: decodeURIComponent(productMatch[2]) },
    };
  }
  const categoryMatch = pathname.match(/^\/catalogo\/([^/]+)\/categoria\/([^/]+)\/?$/);
  if (categoryMatch) {
    return {
      name: "public_category",
      params: { slug: decodeURIComponent(categoryMatch[1]), categorySlug: decodeURIComponent(categoryMatch[2]) },
    };
  }
  const storeMatch = pathname.match(/^\/catalogo\/([^/]+)\/?$/);
  if (storeMatch) {
    return { name: "public_store", params: { slug: decodeURIComponent(storeMatch[1]) } };
  }
  // Admin shell. Capture an optional second segment so /productos/categorias
  // resolves (the productos parent renders the list and expands into sub-routes).
  // Fallback after the public /catalogo/:slug family above.
  const adminMatch = pathname.match(/^\/?([a-z-]+)(?:\/([a-z-]+))?\/?$/);
  return { name: "admin", params: { tab: adminMatch?.[1] || "", sub: adminMatch?.[2] || "" } };
}

// Legacy redirect (unified-products): /catalogo-admin moved to /productos.
// The list was the old parent default, so /catalogo-admin/productos collapses
// onto the parent path itself. History replace + popstate so the app and the
// URL bar land on the new path without an extra back-stack entry.
export function redirectLegacyAdmin(pathname: string): boolean {
  const legacy = pathname.match(/^\/catalogo-admin(?:\/([a-z-]+))?\/?$/);
  if (!legacy) return false;
  const target = legacy[1] && legacy[1] !== "productos" ? `/productos/${legacy[1]}` : "/productos";
  window.history.replaceState({}, "", target);
  window.dispatchEvent(new PopStateEvent("popstate"));
  return true;
}

export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
