// Register the service worker for installability + offline.
// ponytail: minimal. Dev is skipped (SW caching fights HMR); production
// registers — but only for the ADMIN app: the public storefront never
// registers the SW (fresh data on every visit, no offline shell to serve).
export function registerPwa(): void {
  if (import.meta.env?.DEV) return;
  if (!("serviceWorker" in navigator)) return;
  if (window.location.pathname.startsWith("/catalogo/")) return;
  window.addEventListener("load", () => {
    // updateViaCache: "none" makes the browser bypass the HTTP cache when
    // CHECKING for an updated /sw.js. Complements the no-cache header on
    // /sw.js (vercel.json): the header covers the initial load + CDN,
    // updateViaCache covers the update checks. Without this the browser could
    // serve a stale /sw.js from its HTTP cache and never install the new SW.
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {
      // Registration failed: app still works online. No-op.
    });
  });
}
