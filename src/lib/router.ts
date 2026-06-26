// Tiny route matching. A route is "/catalogo/:slug" -> compiled into a regex.
// ponytail: hand-rolled, no dependency. Covers admin (hash-less) + public catalog.

export type RouteName = "public_catalog" | "admin";

export type Route = { name: RouteName; params: Record<string, string> };

export type RouteMatch =
  | { name: "public_catalog"; params: { slug: string } }
  | { name: "admin"; params: { tab?: string } };

// Match a pathname against the public catalog route.
export function matchRoute(pathname: string): RouteMatch {
  const publicMatch = pathname.match(/^\/catalogo\/([^/]+)\/?$/);
  if (publicMatch) {
    return { name: "public_catalog", params: { slug: decodeURIComponent(publicMatch[1]) } };
  }
  // Allow hyphens so /catalogo-admin resolves (distinct from /catalogo/:slug).
  const tabMatch = pathname.match(/^\/?([a-z-]+)\/?$/);
  return { name: "admin", params: { tab: tabMatch?.[1] || "" } };
}

export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
