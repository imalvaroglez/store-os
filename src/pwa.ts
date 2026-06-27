// Register the service worker for installability + offline.
// ponytail: minimal. Dev is skipped (SW caching fights HMR); production registers.
export function registerPwa(): void {
  if (import.meta.env?.DEV) return;
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failed: app still works online. No-op.
    });
  });
}
