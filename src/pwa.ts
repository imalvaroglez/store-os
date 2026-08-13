// Register the service worker for installability + offline.
// ponytail: minimal. Dev is skipped (SW caching fights HMR); production registers.
export function registerPwa(): void {
  if (import.meta.env?.DEV) return;
  if (!("serviceWorker" in navigator)) return;
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
